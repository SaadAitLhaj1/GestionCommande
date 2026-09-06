/* ============================================================
   APP.JS — GESTION DE PRODUITS & COMMANDES
   Architecture : Vanilla JS (sans framework)
   Pattern      : Module Pattern + State centralisé

   RÉSUMÉ DU FLUX DE L'APPLICATION :
   ┌─────────────────────────────────────────────────────┐
   │  localStorage  ←→  Storage  ←→  State  ←→  DOM     │
   │  (persistance)    (lecture/  (mémoire  (ce que      │
   │                    écriture)  vive)     l'user voit) │
   └─────────────────────────────────────────────────────┘

   Quand l'utilisateur fait une action :
     1. On modifie State (la mémoire)
     2. On sauvegarde dans Storage (localStorage)
     3. On appelle un render*() pour mettre le DOM à jour
   ============================================================ */


/* ============================================================
   PARTIE 1 — COUCHE DE STOCKAGE (Storage)

   Rôle : c'est la "base de données" de l'application.
          Elle utilise le localStorage du navigateur pour
          que les données survivent aux rechargements de page.

   Pourquoi le pattern IIFE → (function(){ ... })() ?
   → Crée un module fermé. Les variables PRODUCTS_KEY etc.
     sont PRIVÉES. Seul l'objet retourné par "return {}"
     est accessible depuis l'extérieur (comme des méthodes publiques).

   Structure du localStorage :
     'gc_products' → tableau JSON des produits
     'gc_orders'   → tableau JSON des commandes
     'gc_ids'      → objet { product: N, order: N } (compteurs)
   ============================================================ */
var Storage = (function(){

  // Noms des clés dans le localStorage (comme des noms de tables en SQL)
  var PRODUCTS_KEY = 'gc_products';
  var ORDERS_KEY   = 'gc_orders';
  var IDS_KEY      = 'gc_ids';

  // ── FONCTIONS PRIVÉES (invisibles de l'extérieur) ──

  // Lit et désérialise un tableau JSON depuis le localStorage
  // Le try/catch protège si les données sont corrompues
  function loadArray(key){
    try { return JSON.parse(localStorage.getItem(key) || '[]'); }
    catch(e){ return []; }  // données invalides → retourne un tableau vide
  }

  // Sérialise et sauvegarde un tableau en JSON dans le localStorage
  function saveArray(key, arr){
    localStorage.setItem(key, JSON.stringify(arr));
  }

  // Lit les compteurs d'IDs → ex: { product: 5, order: 3 }
  function loadIds(){
    try { return JSON.parse(localStorage.getItem(IDS_KEY) || '{"product":1,"order":1}'); }
    catch(e){ return { product:1, order:1 }; }
  }

  // Sauvegarde les compteurs d'IDs après mise à jour
  function saveIds(ids){
    localStorage.setItem(IDS_KEY, JSON.stringify(ids));
  }

  // ── API PUBLIQUE (accessible via Storage.xxx()) ──
  return {
    getProducts:  function(){ return loadArray(PRODUCTS_KEY); },
    saveProducts: function(list){ saveArray(PRODUCTS_KEY, list); },
    getOrders:    function(){ return loadArray(ORDERS_KEY); },
    saveOrders:   function(list){ saveArray(ORDERS_KEY, list); },

    // Génère un ID unique auto-incrémenté (comme AUTO_INCREMENT en SQL)
    // type = 'product' ou 'order'
    // 1er appel → retourne 1, 2e appel → retourne 2, etc.
    nextId: function(type){
      var ids = loadIds();
      var val = ids[type] || 1;  // valeur actuelle du compteur
      ids[type] = val + 1;       // incrémente pour le prochain appel
      saveIds(ids);              // persiste le nouveau compteur
      return val;                // retourne l'ID à utiliser maintenant
    },

    // Reset complet (utile pour les tests)
    resetAll: function(){
      localStorage.removeItem(PRODUCTS_KEY);
      localStorage.removeItem(ORDERS_KEY);
      localStorage.removeItem(IDS_KEY);
    }
  };
})();


/* ============================================================
   PARTIE 2 — ÉTAT GLOBAL (State)

   Rôle : source de vérité unique en mémoire vive.
          Toutes les fonctions lisent et modifient cet objet.
          Après chaque modification, un render*() synchronise
          le DOM avec ce nouvel état.

   Analogie : State = tableau blanc partagé | Storage = sa photo.

   Structures :
     products → [{ id, name, cat, price, stock }]
     orders   → [{ id, customer, items, total, notes, createdAt }]
     cart     → [{ productId, name, price, quantity }]
   ============================================================ */
var State = {
  products: [],  // catalogue complet des produits
  orders:   [],  // historique des commandes
  cart:     []   // panier en cours (non persisté, vide à chaque session)
};


/* ============================================================
   PARTIE 3 — UTILITAIRES

   Rôle : petites fonctions pures réutilisables partout.
          "Pure" = ne modifient pas de variables extérieures,
          retournent toujours le même résultat pour les mêmes entrées.
   ============================================================ */

// Formate un nombre en prix lisible  ex: 12.5 → "12.50 dh"
// Math.round(v * 100) / 100 évite les erreurs de flottants (0.1 + 0.2)
function formatCurrency(value){
  return (Math.round(value * 100) / 100).toFixed(2) + ' dh';
}

// Cherche un produit dans State.products par son ID
// Retourne l'objet produit ou undefined si non trouvé
function findProduct(productId){
  return State.products.find(function(p){ return p.id === productId; });
}

// Calcule le total du panier : somme de (prix × quantité) pour chaque article
// reduce() : parcourt le tableau en accumulant les valeurs (acc = accumulateur)
function calculateCartTotal(){
  return State.cart.reduce(function(acc, item){
    return acc + (item.price * item.quantity);
  }, 0);  // 0 = valeur de départ
}

// Table de correspondance catégorie → emoji affiché sur les cartes produit
var CAT_ICONS = {
  'Fournitures':  '🖊️',
  'Électronique': '💻',
  'Mobilier':     '🪑',
  'Autre':        '📦'
};

// Retourne l'icône d'un produit
// Priorité : icône custom du produit > icône de sa catégorie > 📦 par défaut
function iconFor(p){
  return p.icon || CAT_ICONS[p.cat] || '📦';
}

// Affiche une notification temporaire en bas à droite (disparaît après 2.8s)
function toast(msg){
  var t = document.createElement('div');
  t.className   = 'toast';
  t.textContent = msg;
  document.getElementById('toast-wrap').appendChild(t);
  setTimeout(function(){ t.remove(); }, 2800);
}


/* ============================================================
   PARTIE 4 — ÉTAT DES ONGLETS (filtre par catégorie)

   Rôle : mémoriser quelle catégorie est sélectionnée dans
          chaque section. Ces variables sont des "états locaux" de l'UI.

     prodCat  → catégorie active dans la section "Produits"
     orderCat → catégorie active dans la section "Nouvelle commande"

   Quand l'utilisateur clique un onglet :
     1. La variable se met à jour
     2. renderCatalogueGrid() ou renderOrderCatalogue() est appelé
     3. La grille se reconstruit avec le nouveau filtre
   ============================================================ */
var prodCat  = 'Tous';
var orderCat = 'Tous';

// Clique sur un onglet dans la section Produits
function switchProdTab(btn){
  // Retire "active" de tous les onglets
  document.querySelectorAll('#prod-tabs-bar .tab-btn').forEach(function(b){
    b.classList.remove('active');
  });
  btn.classList.add('active');              // active l'onglet cliqué
  prodCat = btn.getAttribute('data-cat');  // mémorise la catégorie (attribut HTML)
  renderCatalogueGrid();                   // rafraîchit la grille
}

// Même logique pour la section Nouvelle commande
function switchOrderTab(btn){
  document.querySelectorAll('#order-tabs-bar .tab-btn').forEach(function(b){
    b.classList.remove('active');
  });
  btn.classList.add('active');
  orderCat = btn.getAttribute('data-cat');
  renderOrderCatalogue();
}


/* ============================================================
   PARTIE 5 — RENDERERS CATALOGUE VISUEL

   Rôle : construire et afficher les cartes produits en grille.
          Deux catalogues coexistent dans l'app :
            1. Section "Produits"          → avec bouton Éditer (admin)
            2. Section "Nouvelle commande" → avec bouton Ajouter (vendeur)

   La fonction centrale est buildProductCard() :
     elle construit le HTML d'une carte et lui branche ses événements.
     Elle est appelée par renderCatalogueGrid() et renderOrderCatalogue().
   ============================================================ */

// Met à jour les petits badges numériques sur chaque onglet
// ex: affiche "12" sur l'onglet "Tous", "4" sur "Fournitures", etc.
// prefix = 'ptc-' (Produits) ou 'otc-' (Commande)
function updateTabCounts(prefix){
  var cats = ['Tous', 'Fournitures', 'Électronique', 'Mobilier', 'Autre'];
  cats.forEach(function(c){
    var el = document.getElementById(prefix + c);
    if(!el) return;
    el.textContent = (c === 'Tous')
      ? State.products.length  // tous les produits
      : State.products.filter(function(p){ return p.cat === c; }).length;  // filtrés
  });
}

// Construit une carte HTML produit et l'insère dans un container DOM
// p         : objet produit { id, name, cat, price, stock }
// container : élément DOM parent où ajouter la carte
// showEdit  : true → affiche le bouton Éditer (section admin uniquement)
function buildProductCard(p, container, showEdit){
  var out      = p.stock === 0;              // rupture totale → carte grisée
  var low      = p.stock > 0 && p.stock <= 5; // stock faible → point orange
  var dotCls   = out ? 'sdot empty' : (low ? 'sdot low' : 'sdot');
  var stockLabel = out ? 'Rupture de stock' : 'Stock : ' + p.stock;

  var card = document.createElement('div');
  card.className = 'product-card' + (out ? ' out-of-stock' : '');

  // Construction du HTML interne de la carte
  card.innerHTML =
    '<div class="product-thumb">' + iconFor(p) + '</div>' +
    '<div class="product-body">' +
      '<div class="product-name">'  + p.name + '</div>' +
      '<div class="product-price">' + formatCurrency(p.price) + '</div>' +
      '<div class="product-stock-info">' +
        '<span class="' + dotCls + '"></span>' + stockLabel +
      '</div>' +
    '</div>' +
    '<div class="product-card-footer">' +
      (showEdit ? '<button class="card-edit-btn">✏️ Éditer</button>' : '') +
      '<button class="card-add-btn"' + (out ? ' disabled' : '') + '>' +
        (out ? 'Indisponible' : '＋ Ajouter') +
      '</button>' +
    '</div>';

  // ── BRANCHEMENT DES ÉVÉNEMENTS ──

  // Clic sur la vignette ou le corps → ouvre la modal fiche produit
  card.querySelector('.product-thumb').onclick = function(){ openModal(p); };
  card.querySelector('.product-body').onclick  = function(){ openModal(p); };

  // Bouton Éditer → pré-remplit le formulaire et navigue vers la section Produits
  if(showEdit){
    card.querySelector('.card-edit-btn').onclick = function(){
      document.getElementById('product-id').value    = String(p.id);
      document.getElementById('product-name').value  = p.name;
      document.getElementById('product-cat').value   = p.cat || 'Autre';
      document.getElementById('product-price').value = String(p.price);
      document.getElementById('product-stock').value = String(p.stock);
      document.querySelector('[data-target="#section-products"]').click();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };
  }

  // Bouton Ajouter → ajoute 1 unité au panier
  // stopPropagation() empêche le clic de remonter et d'ouvrir la modal
  if(!out){
    card.querySelector('.card-add-btn').onclick = function(e){
      e.stopPropagation();
      addToCartDirect(p, 1);
    };
  }

  container.appendChild(card);
}

// Render grille section "Produits" (vue admin avec bouton Éditer)
// Double filtre : catégorie sélectionnée + texte de recherche
function renderCatalogueGrid(){
  updateTabCounts('ptc-');
  var q    = (document.getElementById('product-search').value || '').toLowerCase();
  var list = State.products.filter(function(p){
    return (prodCat === 'Tous' || p.cat === prodCat)
        && p.name.toLowerCase().includes(q);
  });
  var grid = document.getElementById('products-grid');
  grid.innerHTML = '';
  if(!list.length){
    grid.innerHTML = '<div class="empty-state"><div class="empty-icon">🔍</div><p>Aucun produit trouvé.</p></div>';
    return;
  }
  list.forEach(function(p){ buildProductCard(p, grid, true); });  // showEdit = true
}

// Render grille section "Nouvelle commande" (vue vendeur, sans bouton Éditer)
function renderOrderCatalogue(){
  updateTabCounts('otc-');
  var q    = (document.getElementById('order-catalogue-search').value || '').toLowerCase();
  var list = State.products.filter(function(p){
    return (orderCat === 'Tous' || p.cat === orderCat)
        && p.name.toLowerCase().includes(q);
  });
  var grid = document.getElementById('order-products-grid');
  grid.innerHTML = '';
  if(!list.length){
    grid.innerHTML = '<div class="empty-state"><div class="empty-icon">🔍</div><p>Aucun produit trouvé.</p></div>';
    return;
  }
  list.forEach(function(p){ buildProductCard(p, grid, false); });  // showEdit = false
}


/* ============================================================
   PARTIE 6 — RENDER TABLE ADMIN (liste compacte en sidebar)

   Rôle : afficher le tableau texte compact des produits (Nom /
          Prix / Stock / Actions) dans la sidebar de la section Produits.
          C'est la vue "gestion rapide" complémentaire aux cartes.

   Important : renderProducts() appelle aussi renderCatalogueGrid()
   et renderOrderCatalogue() pour maintenir tout synchronisé
   après chaque création, modification ou suppression de produit.
   ============================================================ */
function renderProducts(filterText){
  var tbody = document.querySelector('#products-table tbody');
  tbody.innerHTML = '';
  var q = (filterText || '').toLowerCase();

  State.products
    .filter(function(p){ return p.name.toLowerCase().includes(q); })
    .forEach(function(p){
      // Badge stock coloré : rouge si 0, orange si ≤5, normal sinon
      var stockCls = p.stock === 0 ? 'danger' : p.stock <= 5 ? 'low' : '';
      var tr = document.createElement('tr');
      tr.innerHTML =
        '<td>' + iconFor(p) + ' ' + p.name + '</td>' +
        '<td>' + formatCurrency(p.price) + '</td>' +
        '<td><span class="tag' + (stockCls ? ' ' + stockCls : '') + '">' + p.stock + '</span></td>' +
        // data-action et data-id : utilisés par la délégation d'événements
        '<td><div class="actions">' +
          '<button data-action="edit"   data-id="' + p.id + '" class="ghost" style="padding:6px 9px;font-size:12px;">✏️</button>' +
          '<button data-action="delete" data-id="' + p.id + '" class="ghost danger" style="padding:6px 9px;font-size:12px;">🗑️</button>' +
        '</div></td>';
      tbody.appendChild(tr);
    });

  // Resynchronise les deux catalogues visuels après chaque modif
  renderCatalogueGrid();
  renderOrderCatalogue();
}


/* ============================================================
   PARTIE 7 — MODAL FICHE PRODUIT

   Rôle : afficher une popup avec les détails complets d'un
          produit et permettre de choisir une quantité avant
          de l'ajouter au panier.

   Principe de la modal :
     - #modal-overlay est caché par défaut (CSS display:none)
     - openModal()        → ajoute la classe "open" → devient visible
     - closeModal()       → retire la classe "open" → disparaît
     - _modalProduct      → mémorise le produit actuellement affiché
     - closeModalOutside()→ ferme si l'utilisateur clique le fond noir
                            (pas la boîte blanche)
   ============================================================ */
var _modalProduct = null;  // produit actuellement ouvert dans la modal

// Peuple et affiche la modal pour le produit p
function openModal(p){
  _modalProduct = p;  // mémorisé pour que addFromModal() sache quel produit ajouter

  document.getElementById('modal-icon').textContent  = iconFor(p);
  document.getElementById('modal-name').textContent  = p.name;
  document.getElementById('modal-cat').textContent   = p.cat || '—';
  document.getElementById('modal-price').textContent = formatCurrency(p.price);
  document.getElementById('modal-stock').textContent = p.stock > 0
    ? p.stock + ' unités'
    : '⚠️ Rupture';
  // padStart(4, '0') : formate l'ID sur 4 chiffres → 1 devient "REF-0001"
  document.getElementById('modal-ref').textContent = 'REF-' + String(p.id).padStart(4, '0');

  document.getElementById('modal-qty').value = 1;       // quantité par défaut
  document.getElementById('modal-qty').max   = p.stock; // limite au stock dispo

  document.getElementById('modal-overlay').classList.add('open');
}

function closeModal(){
  document.getElementById('modal-overlay').classList.remove('open');
}

// Ferme uniquement si le clic est sur le fond (overlay) et non sur la boîte
function closeModalOutside(e){
  if(e.target === document.getElementById('modal-overlay')) closeModal();
}

// Ajoute au panier la quantité choisie dans la modal, puis ferme
function addFromModal(){
  if(!_modalProduct) return;
  var qty = parseInt(document.getElementById('modal-qty').value, 10) || 1;
  addToCartDirect(_modalProduct, qty);
  closeModal();
}


/* ============================================================
   PARTIE 8 — LOGIQUE DU PANIER (ajout et modification)

   Rôle : gérer l'ajout et la modification des quantités
          dans State.cart.

   addToCartDirect() est appelée depuis 2 endroits :
     1. Bouton "＋ Ajouter" d'une carte → qty = 1
     2. Bouton "Ajouter au panier" dans la modal → qty = valeur choisie

   changeCartQty() est appelée par les boutons +/− du panier.
   Si la quantité descend à 0, l'article est automatiquement retiré.
   ============================================================ */

// Ajoute qty unités du produit p dans le panier
function addToCartDirect(p, qty){
  if(p.stock === 0){ toast('⚠️ Rupture de stock pour ' + p.name); return; }

  // Le produit est-il déjà dans le panier ?
  var existing = State.cart.find(function(it){ return it.productId === p.id; });

  if(existing){
    // Oui → cumule les quantités et vérifie le stock
    var newQty = existing.quantity + qty;
    if(newQty > p.stock){ toast('⚠️ Stock max atteint (' + p.stock + ')'); return; }
    existing.quantity = newQty;
  } else {
    // Non → crée une nouvelle ligne dans le panier
    State.cart.push({ productId: p.id, name: p.name, price: p.price, quantity: qty });
  }

  renderCart();
  toast('✅ ' + p.name + ' ajouté au panier');
}

// Modifie la quantité d'un article (delta = +1 ou -1)
function changeCartQty(productId, delta){
  var item = State.cart.find(function(i){ return i.productId === productId; });
  if(!item) return;

  var nq = item.quantity + delta;

  if(nq < 1){
    // Quantité à 0 → retire l'article du panier
    State.cart = State.cart.filter(function(i){ return i.productId !== productId; });
  } else {
    // Vérifie que la nouvelle quantité ne dépasse pas le stock réel
    var p = findProduct(productId);
    if(p && nq > p.stock){ toast('⚠️ Stock max : ' + p.stock); return; }
    item.quantity = nq;
  }

  renderCart();
}


/* ============================================================
   PARTIE 9 — RENDU DU PANIER (DOM)

   Rôle : synchroniser l'affichage du panier latéral avec
          State.cart. Appelée après chaque modification du panier.

   Met à jour simultanément :
     - Le badge de comptage (#cart-count)
     - Le total (#cart-total)
     - La liste des articles (ou le message "panier vide")
   ============================================================ */
function renderCart(){
  var wrap = document.getElementById('cart-items-wrap');

  // Nombre total d'unités dans le panier (pas le nombre de lignes)
  var count = State.cart.reduce(function(a, i){ return a + i.quantity; }, 0);
  document.getElementById('cart-count').textContent = count;
  document.getElementById('cart-total').textContent = formatCurrency(calculateCartTotal());

  if(!State.cart.length){
    wrap.innerHTML =
      '<div class="cart-empty">' +
        '<div class="cart-empty-icon">🛍️</div>' +
        '<p>Panier vide.<br>Cliquez sur un produit.</p>' +
      '</div>';
    return;
  }

  wrap.innerHTML = '';
  State.cart.forEach(function(item){
    var p   = findProduct(item.productId);  // pour récupérer l'icône
    var div = document.createElement('div');
    div.className = 'cart-item';
    div.innerHTML =
      '<div class="ci-icon">' + (p ? iconFor(p) : '📦') + '</div>' +
      '<div class="ci-info">' +
        '<div class="ci-name">'  + item.name + '</div>' +
        '<div class="ci-price">' + formatCurrency(item.price * item.quantity) + '</div>' +
      '</div>' +
      '<div class="ci-controls">' +
        // Les boutons +/− appellent changeCartQty avec delta -1 ou +1
        '<button class="qty-btn" onclick="changeCartQty(' + item.productId + ', -1)">−</button>' +
        '<span class="qty-val">' + item.quantity + '</span>' +
        '<button class="qty-btn" onclick="changeCartQty(' + item.productId + ', 1)">+</button>' +
      '</div>' +
      '<button class="ci-remove" onclick="removeFromCart(' + item.productId + ')" title="Retirer">✕</button>';
    wrap.appendChild(div);
  });
}

// Suppression directe d'un article via le bouton ✕
function removeFromCart(productId){
  State.cart = State.cart.filter(function(i){ return i.productId !== productId; });
  renderCart();
}

// Vide entièrement le panier
function handleClearCart(){
  State.cart = [];
  renderCart();
}


/* ============================================================
   PARTIE 10 — CRUD PRODUITS (Créer / Modifier / Supprimer)

   Rôle : gérer le formulaire de création/édition de produit
          et les boutons Éditer/Supprimer du tableau admin.

   Le formulaire fonctionne en double mode :
     - #product-id VIDE   → mode Création (nouveau produit)
     - #product-id REMPLI → mode Édition  (modifie un existant)

   Technique "délégation d'événements" sur le tableau :
     Au lieu de mettre un listener sur chaque bouton,
     un seul listener est posé sur le tableau parent.
     Il lit data-action ("edit" ou "delete") et data-id
     pour savoir quelle action effectuer sur quel produit.
   ============================================================ */

// Remet le formulaire à zéro (mode création vierge)
function resetProductForm(){
  document.getElementById('product-id').value    = '';
  document.getElementById('product-name').value  = '';
  document.getElementById('product-price').value = '';
  document.getElementById('product-stock').value = '';
}

// Soumission du formulaire : création OU mise à jour selon #product-id
function handleProductSubmit(event){
  event.preventDefault();  // empêche le rechargement de la page

  var idRaw = document.getElementById('product-id').value;
  var name  = document.getElementById('product-name').value.trim();
  var cat   = document.getElementById('product-cat').value;
  var price = parseFloat(document.getElementById('product-price').value);
  var stock = parseInt(document.getElementById('product-stock').value, 10);

  if(!name || !(price >= 0) || !(stock >= 0)){
    alert('Veuillez remplir correctement le formulaire.');
    return;
  }

  if(idRaw){
    // ── MODE ÉDITION : on trouve et modifie le produit existant ──
    var id = parseInt(idRaw, 10);
    var ex = State.products.find(function(p){ return p.id === id; });
    if(ex){ ex.name = name; ex.cat = cat; ex.price = price; ex.stock = stock; }
  } else {
    // ── MODE CRÉATION : on pousse un nouveau produit dans le tableau ──
    State.products.push({
      id:    Storage.nextId('product'),  // ID auto-incrémenté unique
      name:  name,
      cat:   cat,
      price: price,
      stock: stock
    });
  }

  Storage.saveProducts(State.products);  // persiste
  resetProductForm();
  renderProducts(document.getElementById('product-search').value);
  toast(idRaw ? '✅ Produit mis à jour' : '✅ Produit ajouté');
}

// Listener délégué sur le tableau des produits
// Capture tous les clics sur les boutons Éditer et Supprimer
function handleProductsTableClick(event){
  var target = event.target;
  var action = target.getAttribute('data-action');/* ============================================================
   APP.JS — GESTION DE PRODUITS & COMMANDES
   Architecture : Vanilla JS (sans framework)
   Pattern      : Module Pattern + State centralisé

   RÉSUMÉ DU FLUX DE L'APPLICATION :
   ┌─────────────────────────────────────────────────────┐
   │  localStorage  ←→  Storage  ←→  State  ←→  DOM     │
   │  (persistance)    (lecture/  (mémoire  (ce que      │
   │                    écriture)  vive)     l'user voit) │
   └─────────────────────────────────────────────────────┘

   Quand l'utilisateur fait une action :
     1. On modifie State (la mémoire)
     2. On sauvegarde dans Storage (localStorage)
     3. On appelle un render*() pour mettre le DOM à jour
   ============================================================ */


/* ============================================================
   PARTIE 1 — COUCHE DE STOCKAGE (Storage)

   Rôle : c'est la "base de données" de l'application.
          Elle utilise le localStorage du navigateur pour
          que les données survivent aux rechargements de page.

   Pourquoi le pattern IIFE → (function(){ ... })() ?
   → Crée un module fermé. Les variables PRODUCTS_KEY etc.
     sont PRIVÉES. Seul l'objet retourné par "return {}"
     est accessible depuis l'extérieur (comme des méthodes publiques).

   Structure du localStorage :
     'gc_products' → tableau JSON des produits
     'gc_orders'   → tableau JSON des commandes
     'gc_ids'      → objet { product: N, order: N } (compteurs)
   ============================================================ */
var Storage = (function(){

  // Noms des clés dans le localStorage (comme des noms de tables en SQL)
  var PRODUCTS_KEY = 'gc_products';
  var ORDERS_KEY   = 'gc_orders';
  var IDS_KEY      = 'gc_ids';

  // ── FONCTIONS PRIVÉES (invisibles de l'extérieur) ──

  // Lit et désérialise un tableau JSON depuis le localStorage
  // Le try/catch protège si les données sont corrompues
  function loadArray(key){
    try { return JSON.parse(localStorage.getItem(key) || '[]'); }
    catch(e){ return []; }  // données invalides → retourne un tableau vide
  }

  // Sérialise et sauvegarde un tableau en JSON dans le localStorage
  function saveArray(key, arr){
    localStorage.setItem(key, JSON.stringify(arr));
  }

  // Lit les compteurs d'IDs → ex: { product: 5, order: 3 }
  function loadIds(){
    try { return JSON.parse(localStorage.getItem(IDS_KEY) || '{"product":1,"order":1}'); }
    catch(e){ return { product:1, order:1 }; }
  }

  // Sauvegarde les compteurs d'IDs après mise à jour
  function saveIds(ids){
    localStorage.setItem(IDS_KEY, JSON.stringify(ids));
  }

  // ── API PUBLIQUE (accessible via Storage.xxx()) ──
  return {
    getProducts:  function(){ return loadArray(PRODUCTS_KEY); },
    saveProducts: function(list){ saveArray(PRODUCTS_KEY, list); },
    getOrders:    function(){ return loadArray(ORDERS_KEY); },
    saveOrders:   function(list){ saveArray(ORDERS_KEY, list); },

    // Génère un ID unique auto-incrémenté (comme AUTO_INCREMENT en SQL)
    // type = 'product' ou 'order'
    // 1er appel → retourne 1, 2e appel → retourne 2, etc.
    nextId: function(type){
      var ids = loadIds();
      var val = ids[type] || 1;  // valeur actuelle du compteur
      ids[type] = val + 1;       // incrémente pour le prochain appel
      saveIds(ids);              // persiste le nouveau compteur
      return val;                // retourne l'ID à utiliser maintenant
    },

    // Reset complet (utile pour les tests)
    resetAll: function(){
      localStorage.removeItem(PRODUCTS_KEY);
      localStorage.removeItem(ORDERS_KEY);
      localStorage.removeItem(IDS_KEY);
    }
  };
})();


/* ============================================================
   PARTIE 2 — ÉTAT GLOBAL (State)

   Rôle : source de vérité unique en mémoire vive.
          Toutes les fonctions lisent et modifient cet objet.
          Après chaque modification, un render*() synchronise
          le DOM avec ce nouvel état.

   Analogie : State = tableau blanc partagé | Storage = sa photo.

   Structures :
     products → [{ id, name, cat, price, stock }]
     orders   → [{ id, customer, items, total, notes, createdAt }]
     cart     → [{ productId, name, price, quantity }]
   ============================================================ */
var State = {
  products: [],  // catalogue complet des produits
  orders:   [],  // historique des commandes
  cart:     []   // panier en cours (non persisté, vide à chaque session)
};


/* ============================================================
   PARTIE 3 — UTILITAIRES

   Rôle : petites fonctions pures réutilisables partout.
          "Pure" = ne modifient pas de variables extérieures,
          retournent toujours le même résultat pour les mêmes entrées.
   ============================================================ */

// Formate un nombre en prix lisible  ex: 12.5 → "12.50 dh"
// Math.round(v * 100) / 100 évite les erreurs de flottants (0.1 + 0.2)
function formatCurrency(value){
  return (Math.round(value * 100) / 100).toFixed(2) + ' dh';
}

// Cherche un produit dans State.products par son ID
// Retourne l'objet produit ou undefined si non trouvé
function findProduct(productId){
  return State.products.find(function(p){ return p.id === productId; });
}

// Calcule le total du panier : somme de (prix × quantité) pour chaque article
// reduce() : parcourt le tableau en accumulant les valeurs (acc = accumulateur)
function calculateCartTotal(){
  return State.cart.reduce(function(acc, item){
    return acc + (item.price * item.quantity);
  }, 0);  // 0 = valeur de départ
}

// Table de correspondance catégorie → emoji affiché sur les cartes produit
var CAT_ICONS = {
  'Fournitures':  '🖊️',
  'Électronique': '💻',
  'Mobilier':     '🪑',
  'Autre':        '📦'
};

// Retourne l'icône d'un produit
// Priorité : icône custom du produit > icône de sa catégorie > 📦 par défaut
function iconFor(p){
  return p.icon || CAT_ICONS[p.cat] || '📦';
}

// Affiche une notification temporaire en bas à droite (disparaît après 2.8s)
function toast(msg){
  var t = document.createElement('div');
  t.className   = 'toast';
  t.textContent = msg;
  document.getElementById('toast-wrap').appendChild(t);
  setTimeout(function(){ t.remove(); }, 2800);
}


/* ============================================================
   PARTIE 4 — ÉTAT DES ONGLETS (filtre par catégorie)

   Rôle : mémoriser quelle catégorie est sélectionnée dans
          chaque section. Ces variables sont des "états locaux" de l'UI.

     prodCat  → catégorie active dans la section "Produits"
     orderCat → catégorie active dans la section "Nouvelle commande"

   Quand l'utilisateur clique un onglet :
     1. La variable se met à jour
     2. renderCatalogueGrid() ou renderOrderCatalogue() est appelé
     3. La grille se reconstruit avec le nouveau filtre
   ============================================================ */
var prodCat  = 'Tous';
var orderCat = 'Tous';

// Clique sur un onglet dans la section Produits
function switchProdTab(btn){
  // Retire "active" de tous les onglets
  document.querySelectorAll('#prod-tabs-bar .tab-btn').forEach(function(b){
    b.classList.remove('active');
  });
  btn.classList.add('active');              // active l'onglet cliqué
  prodCat = btn.getAttribute('data-cat');  // mémorise la catégorie (attribut HTML)
  renderCatalogueGrid();                   // rafraîchit la grille
}

// Même logique pour la section Nouvelle commande
function switchOrderTab(btn){
  document.querySelectorAll('#order-tabs-bar .tab-btn').forEach(function(b){
    b.classList.remove('active');
  });
  btn.classList.add('active');
  orderCat = btn.getAttribute('data-cat');
  renderOrderCatalogue();
}


/* ============================================================
   PARTIE 5 — RENDERERS CATALOGUE VISUEL

   Rôle : construire et afficher les cartes produits en grille.
          Deux catalogues coexistent dans l'app :
            1. Section "Produits"          → avec bouton Éditer (admin)
            2. Section "Nouvelle commande" → avec bouton Ajouter (vendeur)

   La fonction centrale est buildProductCard() :
     elle construit le HTML d'une carte et lui branche ses événements.
     Elle est appelée par renderCatalogueGrid() et renderOrderCatalogue().
   ============================================================ */

// Met à jour les petits badges numériques sur chaque onglet
// ex: affiche "12" sur l'onglet "Tous", "4" sur "Fournitures", etc.
// prefix = 'ptc-' (Produits) ou 'otc-' (Commande)
function updateTabCounts(prefix){
  var cats = ['Tous', 'Fournitures', 'Électronique', 'Mobilier', 'Autre'];
  cats.forEach(function(c){
    var el = document.getElementById(prefix + c);
    if(!el) return;
    el.textContent = (c === 'Tous')
      ? State.products.length  // tous les produits
      : State.products.filter(function(p){ return p.cat === c; }).length;  // filtrés
  });
}

// Construit une carte HTML produit et l'insère dans un container DOM
// p         : objet produit { id, name, cat, price, stock }
// container : élément DOM parent où ajouter la carte
// showEdit  : true → affiche le bouton Éditer (section admin uniquement)
function buildProductCard(p, container, showEdit){
  var out      = p.stock === 0;              // rupture totale → carte grisée
  var low      = p.stock > 0 && p.stock <= 5; // stock faible → point orange
  var dotCls   = out ? 'sdot empty' : (low ? 'sdot low' : 'sdot');
  var stockLabel = out ? 'Rupture de stock' : 'Stock : ' + p.stock;

  var card = document.createElement('div');
  card.className = 'product-card' + (out ? ' out-of-stock' : '');

  // Construction du HTML interne de la carte
  card.innerHTML =
    '<div class="product-thumb">' + iconFor(p) + '</div>' +
    '<div class="product-body">' +
      '<div class="product-name">'  + p.name + '</div>' +
      '<div class="product-price">' + formatCurrency(p.price) + '</div>' +
      '<div class="product-stock-info">' +
        '<span class="' + dotCls + '"></span>' + stockLabel +
      '</div>' +
    '</div>' +
    '<div class="product-card-footer">' +
      (showEdit ? '<button class="card-edit-btn">✏️ Éditer</button>' : '') +
      '<button class="card-add-btn"' + (out ? ' disabled' : '') + '>' +
        (out ? 'Indisponible' : '＋ Ajouter') +
      '</button>' +
    '</div>';

  // ── BRANCHEMENT DES ÉVÉNEMENTS ──

  // Clic sur la vignette ou le corps → ouvre la modal fiche produit
  card.querySelector('.product-thumb').onclick = function(){ openModal(p); };
  card.querySelector('.product-body').onclick  = function(){ openModal(p); };

  // Bouton Éditer → pré-remplit le formulaire et navigue vers la section Produits
  if(showEdit){
    card.querySelector('.card-edit-btn').onclick = function(){
      document.getElementById('product-id').value    = String(p.id);
      document.getElementById('product-name').value  = p.name;
      document.getElementById('product-cat').value   = p.cat || 'Autre';
      document.getElementById('product-price').value = String(p.price);
      document.getElementById('product-stock').value = String(p.stock);
      document.querySelector('[data-target="#section-products"]').click();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };
  }

  // Bouton Ajouter → ajoute 1 unité au panier
  // stopPropagation() empêche le clic de remonter et d'ouvrir la modal
  if(!out){
    card.querySelector('.card-add-btn').onclick = function(e){
      e.stopPropagation();
      addToCartDirect(p, 1);
    };
  }

  container.appendChild(card);
}

// Render grille section "Produits" (vue admin avec bouton Éditer)
// Double filtre : catégorie sélectionnée + texte de recherche
function renderCatalogueGrid(){
  updateTabCounts('ptc-');
  var q    = (document.getElementById('product-search').value || '').toLowerCase();
  var list = State.products.filter(function(p){
    return (prodCat === 'Tous' || p.cat === prodCat)
        && p.name.toLowerCase().includes(q);
  });
  var grid = document.getElementById('products-grid');
  grid.innerHTML = '';
  if(!list.length){
    grid.innerHTML = '<div class="empty-state"><div class="empty-icon">🔍</div><p>Aucun produit trouvé.</p></div>';
    return;
  }
  list.forEach(function(p){ buildProductCard(p, grid, true); });  // showEdit = true
}

// Render grille section "Nouvelle commande" (vue vendeur, sans bouton Éditer)
function renderOrderCatalogue(){
  updateTabCounts('otc-');
  var q    = (document.getElementById('order-catalogue-search').value || '').toLowerCase();
  var list = State.products.filter(function(p){
    return (orderCat === 'Tous' || p.cat === orderCat)
        && p.name.toLowerCase().includes(q);
  });
  var grid = document.getElementById('order-products-grid');
  grid.innerHTML = '';
  if(!list.length){
    grid.innerHTML = '<div class="empty-state"><div class="empty-icon">🔍</div><p>Aucun produit trouvé.</p></div>';
    return;
  }
  list.forEach(function(p){ buildProductCard(p, grid, false); });  // showEdit = false
}


/* ============================================================
   PARTIE 6 — RENDER TABLE ADMIN (liste compacte en sidebar)

   Rôle : afficher le tableau texte compact des produits (Nom /
          Prix / Stock / Actions) dans la sidebar de la section Produits.
          C'est la vue "gestion rapide" complémentaire aux cartes.

   Important : renderProducts() appelle aussi renderCatalogueGrid()
   et renderOrderCatalogue() pour maintenir tout synchronisé
   après chaque création, modification ou suppression de produit.
   ============================================================ */
function renderProducts(filterText){
  var tbody = document.querySelector('#products-table tbody');
  tbody.innerHTML = '';
  var q = (filterText || '').toLowerCase();

  State.products
    .filter(function(p){ return p.name.toLowerCase().includes(q); })
    .forEach(function(p){
      // Badge stock coloré : rouge si 0, orange si ≤5, normal sinon
      var stockCls = p.stock === 0 ? 'danger' : p.stock <= 5 ? 'low' : '';
      var tr = document.createElement('tr');
      tr.innerHTML =
        '<td>' + iconFor(p) + ' ' + p.name + '</td>' +
        '<td>' + formatCurrency(p.price) + '</td>' +
        '<td><span class="tag' + (stockCls ? ' ' + stockCls : '') + '">' + p.stock + '</span></td>' +
        // data-action et data-id : utilisés par la délégation d'événements
        '<td><div class="actions">' +
          '<button data-action="edit"   data-id="' + p.id + '" class="ghost" style="padding:6px 9px;font-size:12px;">✏️</button>' +
          '<button data-action="delete" data-id="' + p.id + '" class="ghost danger" style="padding:6px 9px;font-size:12px;">🗑️</button>' +
        '</div></td>';
      tbody.appendChild(tr);
    });

  // Resynchronise les deux catalogues visuels après chaque modif
  renderCatalogueGrid();
  renderOrderCatalogue();
}


/* ============================================================
   PARTIE 7 — MODAL FICHE PRODUIT

   Rôle : afficher une popup avec les détails complets d'un
          produit et permettre de choisir une quantité avant
          de l'ajouter au panier.

   Principe de la modal :
     - #modal-overlay est caché par défaut (CSS display:none)
     - openModal()        → ajoute la classe "open" → devient visible
     - closeModal()       → retire la classe "open" → disparaît
     - _modalProduct      → mémorise le produit actuellement affiché
     - closeModalOutside()→ ferme si l'utilisateur clique le fond noir
                            (pas la boîte blanche)
   ============================================================ */
var _modalProduct = null;  // produit actuellement ouvert dans la modal

// Peuple et affiche la modal pour le produit p
function openModal(p){
  _modalProduct = p;  // mémorisé pour que addFromModal() sache quel produit ajouter

  document.getElementById('modal-icon').textContent  = iconFor(p);
  document.getElementById('modal-name').textContent  = p.name;
  document.getElementById('modal-cat').textContent   = p.cat || '—';
  document.getElementById('modal-price').textContent = formatCurrency(p.price);
  document.getElementById('modal-stock').textContent = p.stock > 0
    ? p.stock + ' unités'
    : '⚠️ Rupture';
  // padStart(4, '0') : formate l'ID sur 4 chiffres → 1 devient "REF-0001"
  document.getElementById('modal-ref').textContent = 'REF-' + String(p.id).padStart(4, '0');

  document.getElementById('modal-qty').value = 1;       // quantité par défaut
  document.getElementById('modal-qty').max   = p.stock; // limite au stock dispo

  document.getElementById('modal-overlay').classList.add('open');
}

function closeModal(){
  document.getElementById('modal-overlay').classList.remove('open');
}

// Ferme uniquement si le clic est sur le fond (overlay) et non sur la boîte
function closeModalOutside(e){
  if(e.target === document.getElementById('modal-overlay')) closeModal();
}

// Ajoute au panier la quantité choisie dans la modal, puis ferme
function addFromModal(){
  if(!_modalProduct) return;
  var qty = parseInt(document.getElementById('modal-qty').value, 10) || 1;
  addToCartDirect(_modalProduct, qty);
  closeModal();
}


/* ============================================================
   PARTIE 8 — LOGIQUE DU PANIER (ajout et modification)

   Rôle : gérer l'ajout et la modification des quantités
          dans State.cart.

   addToCartDirect() est appelée depuis 2 endroits :
     1. Bouton "＋ Ajouter" d'une carte → qty = 1
     2. Bouton "Ajouter au panier" dans la modal → qty = valeur choisie

   changeCartQty() est appelée par les boutons +/− du panier.
   Si la quantité descend à 0, l'article est automatiquement retiré.
   ============================================================ */

// Ajoute qty unités du produit p dans le panier
function addToCartDirect(p, qty){
  if(p.stock === 0){ toast('⚠️ Rupture de stock pour ' + p.name); return; }

  // Le produit est-il déjà dans le panier ?
  var existing = State.cart.find(function(it){ return it.productId === p.id; });

  if(existing){
    // Oui → cumule les quantités et vérifie le stock
    var newQty = existing.quantity + qty;
    if(newQty > p.stock){ toast('⚠️ Stock max atteint (' + p.stock + ')'); return; }
    existing.quantity = newQty;
  } else {
    // Non → crée une nouvelle ligne dans le panier
    State.cart.push({ productId: p.id, name: p.name, price: p.price, quantity: qty });
  }

  renderCart();
  toast('✅ ' + p.name + ' ajouté au panier');
}

// Modifie la quantité d'un article (delta = +1 ou -1)
function changeCartQty(productId, delta){
  var item = State.cart.find(function(i){ return i.productId === productId; });
  if(!item) return;

  var nq = item.quantity + delta;

  if(nq < 1){
    // Quantité à 0 → retire l'article du panier
    State.cart = State.cart.filter(function(i){ return i.productId !== productId; });
  } else {
    // Vérifie que la nouvelle quantité ne dépasse pas le stock réel
    var p = findProduct(productId);
    if(p && nq > p.stock){ toast('⚠️ Stock max : ' + p.stock); return; }
    item.quantity = nq;
  }

  renderCart();
}


/* ============================================================
   PARTIE 9 — RENDU DU PANIER (DOM)

   Rôle : synchroniser l'affichage du panier latéral avec
          State.cart. Appelée après chaque modification du panier.

   Met à jour simultanément :
     - Le badge de comptage (#cart-count)
     - Le total (#cart-total)
     - La liste des articles (ou le message "panier vide")
   ============================================================ */
function renderCart(){
  var wrap = document.getElementById('cart-items-wrap');

  // Nombre total d'unités dans le panier (pas le nombre de lignes)
  var count = State.cart.reduce(function(a, i){ return a + i.quantity; }, 0);
  document.getElementById('cart-count').textContent = count;
  document.getElementById('cart-total').textContent = formatCurrency(calculateCartTotal());

  if(!State.cart.length){
    wrap.innerHTML =
      '<div class="cart-empty">' +
        '<div class="cart-empty-icon">🛍️</div>' +
        '<p>Panier vide.<br>Cliquez sur un produit.</p>' +
      '</div>';
    return;
  }

  wrap.innerHTML = '';
  State.cart.forEach(function(item){
    var p   = findProduct(item.productId);  // pour récupérer l'icône
    var div = document.createElement('div');
    div.className = 'cart-item';
    div.innerHTML =
      '<div class="ci-icon">' + (p ? iconFor(p) : '📦') + '</div>' +
      '<div class="ci-info">' +
        '<div class="ci-name">'  + item.name + '</div>' +
        '<div class="ci-price">' + formatCurrency(item.price * item.quantity) + '</div>' +
      '</div>' +
      '<div class="ci-controls">' +
        // Les boutons +/− appellent changeCartQty avec delta -1 ou +1
        '<button class="qty-btn" onclick="changeCartQty(' + item.productId + ', -1)">−</button>' +
        '<span class="qty-val">' + item.quantity + '</span>' +
        '<button class="qty-btn" onclick="changeCartQty(' + item.productId + ', 1)">+</button>' +
      '</div>' +
      '<button class="ci-remove" onclick="removeFromCart(' + item.productId + ')" title="Retirer">✕</button>';
    wrap.appendChild(div);
  });
}

// Suppression directe d'un article via le bouton ✕
function removeFromCart(productId){
  State.cart = State.cart.filter(function(i){ return i.productId !== productId; });
  renderCart();
}

// Vide entièrement le panier
function handleClearCart(){
  State.cart = [];
  renderCart();
}


/* ============================================================
   PARTIE 10 — CRUD PRODUITS (Créer / Modifier / Supprimer)

   Rôle : gérer le formulaire de création/édition de produit
          et les boutons Éditer/Supprimer du tableau admin.

   Le formulaire fonctionne en double mode :
     - #product-id VIDE   → mode Création (nouveau produit)
     - #product-id REMPLI → mode Édition  (modifie un existant)

   Technique "délégation d'événements" sur le tableau :
     Au lieu de mettre un listener sur chaque bouton,
     un seul listener est posé sur le tableau parent.
     Il lit data-action ("edit" ou "delete") et data-id
     pour savoir quelle action effectuer sur quel produit.
   ============================================================ */

// Remet le formulaire à zéro (mode création vierge)
function resetProductForm(){
  document.getElementById('product-id').value    = '';
  document.getElementById('product-name').value  = '';
  document.getElementById('product-price').value = '';
  document.getElementById('product-stock').value = '';
}

// Soumission du formulaire : création OU mise à jour selon #product-id
function handleProductSubmit(event){
  event.preventDefault();  // empêche le rechargement de la page

  var idRaw = document.getElementById('product-id').value;
  var name  = document.getElementById('product-name').value.trim();
  var cat   = document.getElementById('product-cat').value;
  var price = parseFloat(document.getElementById('product-price').value);
  var stock = parseInt(document.getElementById('product-stock').value, 10);

  if(!name || !(price >= 0) || !(stock >= 0)){
    alert('Veuillez remplir correctement le formulaire.');
    return;
  }

  if(idRaw){
    // ── MODE ÉDITION : on trouve et modifie le produit existant ──
    var id = parseInt(idRaw, 10);
    var ex = State.products.find(function(p){ return p.id === id; });
    if(ex){ ex.name = name; ex.cat = cat; ex.price = price; ex.stock = stock; }
  } else {
    // ── MODE CRÉATION : on pousse un nouveau produit dans le tableau ──
    State.products.push({
      id:    Storage.nextId('product'),  // ID auto-incrémenté unique
      name:  name,
      cat:   cat,
      price: price,
      stock: stock
    });
  }

  Storage.saveProducts(State.products);  // persiste
  resetProductForm();
  renderProducts(document.getElementById('product-search').value);
  toast(idRaw ? '✅ Produit mis à jour' : '✅ Produit ajouté');
}

// Listener délégué sur le tableau des produits
// Capture tous les clics sur les boutons Éditer et Supprimer
function handleProductsTableClick(event){
  var target = event.target;
  var action = target.getAttribute('data-action');
  if(!action) return;  // clic ailleurs → ignore

  if(action === 'edit'){
    var id = parseInt(target.getAttribute('data-id'), 10);
    var p  = State.products.find(function(x){ return x.id === id; });
    if(!p) return;
    // Pré-remplit le formulaire avec les données du produit sélectionné
    document.getElementById('product-id').value    = String(p.id);
    document.getElementById('product-name').value  = p.name;
    document.getElementById('product-cat').value   = p.cat || 'Autre';
    document.getElementById('product-price').value = String(p.price);
    document.getElementById('product-stock').value = String(p.stock);
    document.querySelector('[data-target="#section-products"]').click();
  }

  if(action === 'delete'){
    var idd = parseInt(target.getAttribute('data-id'), 10);
    if(confirm('Supprimer ce produit ?')){
      State.products = State.products.filter(function(x){ return x.id !== idd; });
      // Retire aussi ce produit du panier s'il y était
      State.cart     = State.cart.filter(function(c){ return c.productId !== idd; });
      Storage.saveProducts(State.products);
      renderProducts(document.getElementById('product-search').value);
      renderCart();
    }
  }
}


/* ============================================================
   PARTIE 11 — VALIDATION ET ENREGISTREMENT D'UNE COMMANDE

   Rôle : transformer le panier en commande définitive.

   Étapes dans l'ordre :
     1. Vérifier que le panier n'est pas vide
     2. Vérifier que le nom du client est renseigné
     3. Revérifier les stocks article par article
     4. Déduire les quantités commandées des stocks produits
     5. Construire l'objet commande et l'enregistrer
     6. Réinitialiser panier + formulaires
     7. Rafraîchir tous les affichages
   ============================================================ */
function handleSubmitOrder(event){
  event.preventDefault();

  if(State.cart.length === 0){ alert('Le panier est vide.'); return; }

  var customer = document.getElementById('customer-name').value.trim();
  var notes    = document.getElementById('order-notes').value.trim();

  if(!customer){ alert('Le nom du client est requis.'); return; }

  // Étape 3 : re-vérification des stocks (peuvent avoir changé depuis l'ajout)
  for(var i = 0; i < State.cart.length; i++){
    var it   = State.cart[i];
    var prod = findProduct(it.productId);
    if(!prod || it.quantity > prod.stock){
      alert('Stock insuffisant pour ' + it.name + '.');
      return;
    }
  }

  // Étape 4 : déduction des stocks produits
  State.cart.forEach(function(it){
    var prod = findProduct(it.productId);
    if(prod){ prod.stock -= it.quantity; }
  });

  // Étape 5 : construction de l'objet commande
  var order = {
    id:       Storage.nextId('order'),
    customer: customer,
    // Snapshot des articles : copie les prix au moment de la commande
    // (si le prix change ensuite, la commande garde l'ancien tarif)
    items:    State.cart.map(function(it){
                return { productId: it.productId, name: it.name, price: it.price, quantity: it.quantity };
              }),
    total:     calculateCartTotal(),
    notes:     notes,
    createdAt: new Date().toISOString()  // ex: "2026-03-09T10:30:00.000Z"
  };

  State.orders.unshift(order);          // en tête de liste → plus récent en premier
  Storage.saveOrders(State.orders);
  Storage.saveProducts(State.products); // stocks mis à jour

  // Étape 6 : réinitialisation
  State.cart = [];
  document.getElementById('order-form').reset();

  // Étape 7 : rafraîchissement
  renderCart();
  renderProducts(document.getElementById('product-search').value);
  renderOrders(document.getElementById('order-search').value);
  toast('🎉 Commande #' + order.id + ' enregistrée pour ' + customer + ' !');
}


/* ============================================================
   PARTIE 12 — AFFICHAGE ET GESTION DES COMMANDES

   Rôle : afficher l'historique dans un tableau filtrable et
          permettre suppression unitaire, globale, et export JSON.

   renderOrders(filterText) :
     filtre par ID de commande OU par nom de client.

   handleExportOrders() :
     Crée un lien <a> dynamique avec les données encodées en URI
     et simule un clic pour déclencher le téléchargement.
     Technique standard pour télécharger un fichier côté client.
   ============================================================ */
function renderOrders(filterText){
  var tbody = document.querySelector('#orders-table tbody');
  tbody.innerHTML = '';
  var q = (filterText || '').toLowerCase();

  State.orders
    .filter(function(o){
      return String(o.id).includes(q) || o.customer.toLowerCase().includes(q);
    })
    .forEach(function(o){
      var dateStr  = new Date(o.createdAt).toLocaleString();
      var itemsStr = o.items.map(function(i){ return i.name + ' x' + i.quantity; }).join(', ');
      var tr = document.createElement('tr');
      tr.innerHTML =
        '<td>#' + o.id + '</td>' +
        '<td><small class="muted">' + dateStr + '</small></td>' +
        '<td>' + o.customer + '</td>' +
        '<td>' + itemsStr + '</td>' +
        '<td>' + formatCurrency(o.total) + '</td>' +
        '<td><div class="actions">' +
          '<button data-action="delete-order" data-id="' + o.id + '" class="ghost danger" style="padding:6px 9px;font-size:12px;">🗑️</button>' +
        '</div></td>';
      tbody.appendChild(tr);
    });
}

// Suppression unitaire via délégation d'événements
function handleOrdersTableClick(event){
  var action = event.target.getAttribute('data-action');
  if(action === 'delete-order'){
    var id = parseInt(event.target.getAttribute('data-id'), 10);
    if(confirm('Supprimer la commande #' + id + ' ?')){
      State.orders = State.orders.filter(function(o){ return o.id !== id; });
      Storage.saveOrders(State.orders);
      renderOrders(document.getElementById('order-search').value);
    }
  }
}

// Export JSON : télécharge toutes les commandes dans un fichier .json
function handleExportOrders(){
  var d  = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(State.orders, null, 2));
  var dl = document.createElement('a');
  dl.href     = d;
  dl.download = 'commandes.json';
  document.body.appendChild(dl);
  dl.click();   // déclenche le téléchargement
  dl.remove();  // nettoie le DOM
}

// Suppression globale de toutes les commandes
function handleClearOrders(){
  if(confirm('Voulez-vous supprimer toutes les commandes ?')){
    State.orders = [];
    Storage.saveOrders(State.orders);
    renderOrders('');
  }
}


/* ============================================================
   PARTIE 13 — INITIALISATION (point d'entrée unique)

   Rôle : démarrer l'application proprement.

   Pourquoi attendre DOMContentLoaded ?
   → Garantit que tout le HTML est parsé avant d'exécuter le JS.
     Sans ça, document.getElementById() retournerait null car
     les éléments du DOM n'existeraient pas encore.

   Ordre des opérations dans init() :
     1. Charge les données depuis localStorage → State
     2. Branche tous les écouteurs d'événements (addEventListener)
     3. Déclenche le premier rendu de l'interface
   ============================================================ */
function init(){
  // ── 1. CHARGEMENT DES DONNÉES ──
  State.products = Storage.getProducts();
  State.orders   = Storage.getOrders();
  // State.cart reste vide volontairement (pas persisté entre sessions)

  // ── 2. LISTENERS — Section Produits ──
  document.getElementById('product-form')
    .addEventListener('submit', handleProductSubmit);

  // setTimeout(fn, 0) : laisse le navigateur exécuter le reset natif du formulaire
  // AVANT notre resetProductForm() custom, pour éviter qu'il l'écrase
  document.getElementById('product-reset')
    .addEventListener('click', function(){ setTimeout(resetProductForm, 0); });

  // Délégation : un listener parent capture tous les clics Éditer/Supprimer
  document.getElementById('products-table')
    .addEventListener('click', handleProductsTableClick);

  // Filtre en temps réel à chaque frappe dans la recherche
  document.getElementById('product-search')
    .addEventListener('input', function(e){ renderProducts(e.target.value); });

  // ── 3. LISTENERS — Section Panier / Commande ──
  document.getElementById('clear-cart')
    .addEventListener('click', handleClearCart);

  document.getElementById('order-form')
    .addEventListener('submit', handleSubmitOrder);

  // ── 4. LISTENERS — Section Commandes ──
  document.getElementById('orders-table')
    .addEventListener('click', handleOrdersTableClick);

  document.getElementById('order-search')
    .addEventListener('input', function(e){ renderOrders(e.target.value); });

  document.getElementById('export-orders')
    .addEventListener('click', handleExportOrders);

  document.getElementById('clear-orders')
    .addEventListener('click', handleClearOrders);

  // ── 5. PREMIER RENDU DE L'INTERFACE ──
  renderProducts('');       // table admin + deux catalogues visuels
  renderOrderCatalogue();   // catalogue section commande (déjà appelé ci-dessus mais explicite)
  renderCart();             // affiche le panier vide
  renderOrders('');         // affiche l'historique des commandes
}

// Lance l'application quand tout le HTML est prêt
document.addEventListener('DOMContentLoaded', init);
  if(!action) return;  // clic ailleurs → ignore

  if(action === 'edit'){
    var id = parseInt(target.getAttribute('data-id'), 10);
    var p  = State.products.find(function(x){ return x.id === id; });
    if(!p) return;
    // Pré-remplit le formulaire avec les données du produit sélectionné
    document.getElementById('product-id').value    = String(p.id);
    document.getElementById('product-name').value  = p.name;
    document.getElementById('product-cat').value   = p.cat || 'Autre';
    document.getElementById('product-price').value = String(p.price);
    document.getElementById('product-stock').value = String(p.stock);
    document.querySelector('[data-target="#section-products"]').click();
  }

  if(action === 'delete'){
    var idd = parseInt(target.getAttribute('data-id'), 10);
    if(confirm('Supprimer ce produit ?')){
      State.products = State.products.filter(function(x){ return x.id !== idd; });
      // Retire aussi ce produit du panier s'il y était
      State.cart     = State.cart.filter(function(c){ return c.productId !== idd; });
      Storage.saveProducts(State.products);
      renderProducts(document.getElementById('product-search').value);
      renderCart();
    }
  }
}


/* ============================================================
   PARTIE 11 — VALIDATION ET ENREGISTREMENT D'UNE COMMANDE

   Rôle : transformer le panier en commande définitive.

   Étapes dans l'ordre :
     1. Vérifier que le panier n'est pas vide
     2. Vérifier que le nom du client est renseigné
     3. Revérifier les stocks article par article
     4. Déduire les quantités commandées des stocks produits
     5. Construire l'objet commande et l'enregistrer
     6. Réinitialiser panier + formulaires
     7. Rafraîchir tous les affichages
   ============================================================ */
function handleSubmitOrder(event){
  event.preventDefault();

  if(State.cart.length === 0){ alert('Le panier est vide.'); return; }

  var customer = document.getElementById('customer-name').value.trim();
  var notes    = document.getElementById('order-notes').value.trim();

  if(!customer){ alert('Le nom du client est requis.'); return; }

  // Étape 3 : re-vérification des stocks (peuvent avoir changé depuis l'ajout)
  for(var i = 0; i < State.cart.length; i++){
    var it   = State.cart[i];
    var prod = findProduct(it.productId);
    if(!prod || it.quantity > prod.stock){
      alert('Stock insuffisant pour ' + it.name + '.');
      return;
    }
  }

  // Étape 4 : déduction des stocks produits
  State.cart.forEach(function(it){
    var prod = findProduct(it.productId);
    if(prod){ prod.stock -= it.quantity; }
  });

  // Étape 5 : construction de l'objet commande
  var order = {
    id:       Storage.nextId('order'),
    customer: customer,
    // Snapshot des articles : copie les prix au moment de la commande
    // (si le prix change ensuite, la commande garde l'ancien tarif)
    items:    State.cart.map(function(it){
                return { productId: it.productId, name: it.name, price: it.price, quantity: it.quantity };
              }),
    total:     calculateCartTotal(),
    notes:     notes,
    createdAt: new Date().toISOString()  // ex: "2026-03-09T10:30:00.000Z"
  };

  State.orders.unshift(order);          // en tête de liste → plus récent en premier
  Storage.saveOrders(State.orders);
  Storage.saveProducts(State.products); // stocks mis à jour

  // Étape 6 : réinitialisation
  State.cart = [];
  document.getElementById('order-form').reset();

  // Étape 7 : rafraîchissement
  renderCart();
  renderProducts(document.getElementById('product-search').value);
  renderOrders(document.getElementById('order-search').value);
  toast('🎉 Commande #' + order.id + ' enregistrée pour ' + customer + ' !');
}


/* ============================================================
   PARTIE 12 — AFFICHAGE ET GESTION DES COMMANDES

   Rôle : afficher l'historique dans un tableau filtrable et
          permettre suppression unitaire, globale, et export JSON.

   renderOrders(filterText) :
     filtre par ID de commande OU par nom de client.

   handleExportOrders() :
     Crée un lien <a> dynamique avec les données encodées en URI
     et simule un clic pour déclencher le téléchargement.
     Technique standard pour télécharger un fichier côté client.
   ============================================================ */
function renderOrders(filterText){
  var tbody = document.querySelector('#orders-table tbody');
  tbody.innerHTML = '';
  var q = (filterText || '').toLowerCase();

  State.orders
    .filter(function(o){
      return String(o.id).includes(q) || o.customer.toLowerCase().includes(q);
    })
    .forEach(function(o){
      var dateStr  = new Date(o.createdAt).toLocaleString();
      var itemsStr = o.items.map(function(i){ return i.name + ' x' + i.quantity; }).join(', ');
      var tr = document.createElement('tr');
      tr.innerHTML =
        '<td>#' + o.id + '</td>' +
        '<td><small class="muted">' + dateStr + '</small></td>' +
        '<td>' + o.customer + '</td>' +
        '<td>' + itemsStr + '</td>' +
        '<td>' + formatCurrency(o.total) + '</td>' +
        '<td><div class="actions">' +
          '<button data-action="delete-order" data-id="' + o.id + '" class="ghost danger" style="padding:6px 9px;font-size:12px;">🗑️</button>' +
        '</div></td>';
      tbody.appendChild(tr);
    });
}

// Suppression unitaire via délégation d'événements
function handleOrdersTableClick(event){
  var action = event.target.getAttribute('data-action');
  if(action === 'delete-order'){
    var id = parseInt(event.target.getAttribute('data-id'), 10);
    if(confirm('Supprimer la commande #' + id + ' ?')){
      State.orders = State.orders.filter(function(o){ return o.id !== id; });
      Storage.saveOrders(State.orders);
      renderOrders(document.getElementById('order-search').value);
    }
  }
}

// Export JSON : télécharge toutes les commandes dans un fichier .json
function handleExportOrders(){
  var d  = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(State.orders, null, 2));
  var dl = document.createElement('a');
  dl.href     = d;
  dl.download = 'commandes.json';
  document.body.appendChild(dl);
  dl.click();   // déclenche le téléchargement
  dl.remove();  // nettoie le DOM
}

// Suppression globale de toutes les commandes
function handleClearOrders(){
  if(confirm('Voulez-vous supprimer toutes les commandes ?')){
    State.orders = [];
    Storage.saveOrders(State.orders);
    renderOrders('');
  }
}


/* ============================================================
   PARTIE 13 — INITIALISATION (point d'entrée unique)

   Rôle : démarrer l'application proprement.

   Pourquoi attendre DOMContentLoaded ?
   → Garantit que tout le HTML est parsé avant d'exécuter le JS.
     Sans ça, document.getElementById() retournerait null car
     les éléments du DOM n'existeraient pas encore.

   Ordre des opérations dans init() :
     1. Charge les données depuis localStorage → State
     2. Branche tous les écouteurs d'événements (addEventListener)
     3. Déclenche le premier rendu de l'interface
   ============================================================ */
function init(){
  // ── 1. CHARGEMENT DES DONNÉES ──
  State.products = Storage.getProducts();
  State.orders   = Storage.getOrders();
  // State.cart reste vide volontairement (pas persisté entre sessions)

  // ── 2. LISTENERS — Section Produits ──
  document.getElementById('product-form')
    .addEventListener('submit', handleProductSubmit);

  // setTimeout(fn, 0) : laisse le navigateur exécuter le reset natif du formulaire
  // AVANT notre resetProductForm() custom, pour éviter qu'il l'écrase
  document.getElementById('product-reset')
    .addEventListener('click', function(){ setTimeout(resetProductForm, 0); });

  // Délégation : un listener parent capture tous les clics Éditer/Supprimer
  document.getElementById('products-table')
    .addEventListener('click', handleProductsTableClick);

  // Filtre en temps réel à chaque frappe dans la recherche
  document.getElementById('product-search')
    .addEventListener('input', function(e){ renderProducts(e.target.value); });

  // ── 3. LISTENERS — Section Panier / Commande ──
  document.getElementById('clear-cart')
    .addEventListener('click', handleClearCart);

  document.getElementById('order-form')
    .addEventListener('submit', handleSubmitOrder);

  // ── 4. LISTENERS — Section Commandes ──
  document.getElementById('orders-table')
    .addEventListener('click', handleOrdersTableClick);

  document.getElementById('order-search')
    .addEventListener('input', function(e){ renderOrders(e.target.value); });

  document.getElementById('export-orders')
    .addEventListener('click', handleExportOrders);

  document.getElementById('clear-orders')
    .addEventListener('click', handleClearOrders);

  // ── 5. PREMIER RENDU DE L'INTERFACE ──
  renderProducts('');       // table admin + deux catalogues visuels
  renderOrderCatalogue();   // catalogue section commande (déjà appelé ci-dessus mais explicite)
  renderCart();             // affiche le panier vide
  renderOrders('');         // affiche l'historique des commandes
}

// Lance l'application quand tout le HTML est prêt
document.addEventListener('DOMContentLoaded', init);