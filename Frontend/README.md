# Gestion de Produits & Commandes

## Description du projet

Ce projet est une application web de gestion commerciale conçue pour simplifier la gestion des produits, du stock et des commandes. Il s’adresse aux petites et moyennes structures qui souhaitent centraliser leurs opérations dans un tableau de bord simple, moderne et fonctionnel.

L’application permet de :
- gérer le catalogue des produits,
- mettre à jour les prix et les quantités en stock,
- ajouter des produits au panier,
- enregistrer des commandes clients,
- consulter l’historique des commandes,
- exporter les données au format JSON,
- garder les informations en local dans le navigateur via `localStorage`.

---

## Objectif principal

Offrir une interface professionnelle, rapide et intuitive pour gérer les ventes et le stock sans dépendre d’une base de données externe. Le projet est pensé comme une solution légère, pratique et facilement démontrable lors d’une présentation.

---

## Fonctionnalités

### 1. Gestion des produits
- ajout d’un produit,
- modification d’un produit existant,
- suppression d’un produit,
- filtrage par catégorie,
- recherche rapide,
- suivi du stock avec alertes visuelles.

### 2. Gestion des commandes
- création d’une commande client,
- ajout de plusieurs articles dans le panier,
- validation du stock avant commande,
- calcul automatique du montant total,
- enregistrement de l’historique des commandes,
- suppression d’une commande ou de toutes les commandes,
- export JSON des données.

### 3. Tableau de bord
- statistiques globales :
  - nombre de produits,
  - stock total,
  - nombre de commandes,
  - CA estimé,
- navigation rapide entre sections,
- design moderne et professionnel.

---

## Technologie utilisée

- HTML5
- CSS3
- JavaScript vanilla
- LocalStorage pour la persistance des données

---

## Structure du projet

```text
project1/
└── Frontend/
    ├── index.html
    ├── styles.css
    ├── app.js
    └── README.md
```

---

## Aperçu du système

L’application est organisée en trois grandes sections :

1. Produits  
   Gestion du catalogue et du stock.

2. Nouvelle commande  
   Sélection des produits et validation du panier.

3. Commandes  
   Historique complet des ventes et actions de gestion.

---

## Comment utiliser le projet

### Étape 1 : Ouvrir le projet
Ouvrez le fichier `index.html` dans le navigateur.

### Étape 2 : Ajouter un produit
- aller dans la section "Produits",
- remplir le formulaire,
- cliquer sur "Enregistrer".

### Étape 3 : Créer une commande
- ouvrir la section "Nouvelle commande",
- cliquer sur les produits pour les ajouter au panier,
- renseigner le nom du client,
- valider la commande.

### Étape 4 : Consulter l’historique
- aller dans la section "Commandes",
- consulter les détails et exporter les données si nécessaire.

---

## Avantages du projet

- interface moderne et professionnelle,
- gestion complète des opérations commerciales,
- fonctionnement sans serveur ni base de données,
- très facile à démontrer et à présenter,
- idéal pour un prototype ou un projet de soutenance.

---

## Cas d’utilisation

Ce projet peut être utilisé pour :
- un petit commerce,
- un magasin de vente de fournitures,
- une boutique électronique locale,
- une démonstration de gestion commerciale,
- un projet de présentation technique ou académique.

---

## Conclusion

Ce projet met en avant une solution pratique et élégante pour la gestion des produits et des ventes. Il combine simplicité d’utilisation, fonctionnalité métier et interface professionnelle, ce qui le rend adapté à une présentation sérieuse et à un usage réel dans un contexte léger.

---

## Auteur

Projet développé dans le cadre d’une démonstration de gestion commerciale et de gestion des commandes.
