// backend/server.js
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');

// Charge les variables d'environnement du fichier .env UNIQUEMENT si l'environnement n'est pas 'production'.
// En production (sur Render), les variables seront injectées directement par Render.
if (process.env.NODE_ENV !== 'production') {
  dotenv.config();
}

// Importation de la connexion à la base de données (pool et query)
const { pool, query } = require('./db');

// Importation des fonctions d'authentification
const { registerUser, loginUser } = require('./auth'); // Assurez-vous que ce fichier existe et exporte ces fonctions

// Importation des routeurs pour les différentes entités
const clientsRoutes = require('./clients');
const productRoutes = require('./products');
const ventesRoutes = require('./ventes');
const reportsRouter = require('./reports');
const returnsRouter = require('./returns');
const remplacerRouter = require('./remplacements');
const fournisseursRoutes = require('./fournisseurs');
const facturesRoutes = require('./factures');
const specialOrdersRoutes = require('./specialOrders'); // NOUVEL IMPORT pour les commandes spéciales

const app = express();

// Configuration CORS
// En production, remplacez 'https://choco-frontend-app.onrender.com' par l'URL réelle de votre frontend Render.
// Pour le développement local, 'http://localhost:5173' est utilisé.
app.use(cors({
  origin: process.env.NODE_ENV === 'production' ? 'https://choco-frontend-app.onrender.com' : 'http://localhost:5173', // L'URL RÉELLE DE VOTRE FRONTEND RENDER
  credentials: true
}));

// Middleware pour parser les requêtes JSON
app.use(express.json());

// --- ROUTES D'AUTHENTIFICATION ---
app.post('/api/login', loginUser);
app.post('/api/register', registerUser); // Si vous avez une route d'enregistrement

// --- ROUTES POUR LES AUTRES RESSOURCES ---
app.use('/api/clients', clientsRoutes);
app.use('/api/products', productRoutes);
app.use('/api/ventes', ventesRoutes);
app.use('/api/reports', reportsRouter); // Assurez-vous que reportsRouter contient la route /dashboard-stats
app.use('/api/returns', returnsRouter);
app.use('/api/remplacements', remplacerRouter);
app.use('/api/fournisseurs', fournisseursRoutes);
app.use('/api/factures', facturesRoutes);
app.use('/api/special-orders', specialOrdersRoutes); // NOUVELLE ROUTE pour les commandes spéciales

// --- NOUVELLE ROUTE GET POUR CALCULER LES BÉNÉFICES ---
app.get('/api/benefices', async (req, res) => {
    let client;
    try {
        client = await pool.connect();
        let sqlQuery = `
            SELECT
                vi.id AS vente_item_id,
                vi.marque,
                vi.modele,
                vi.stockage,
                vi.type,
                vi.type_carton,
                vi.imei,
                vi.prix_unitaire_achat,
                vi.quantite_vendue,
                v.date_vente,
                v.montant_total AS total_negotiated_sale_price_of_parent_sale, -- Montant total de la vente parente
                vi.prix_unitaire_vente AS original_unit_sale_price,
                vi.statut_vente, -- Ajout du statut de l'article de vente
                -- Calcul du revenu proportionnel et du bénéfice pour les articles actifs
                CASE
                    WHEN vi.statut_vente = 'actif' THEN
                        (vi.prix_unitaire_vente * vi.quantite_vendue) -- Utilise le prix unitaire de l'item
                    ELSE 0 -- Si l'article n'est pas actif, son revenu est 0 pour le bénéfice
                END AS proportional_revenue,
                CASE
                    WHEN vi.statut_vente = 'actif' THEN
                        (vi.prix_unitaire_vente * vi.quantite_vendue) - (vi.prix_unitaire_achat * vi.quantite_vendue)
                    ELSE (0 - (vi.prix_unitaire_achat * vi.quantite_vendue)) -- Si l'article est inactif, le bénéfice est la perte du coût d'achat
                END AS benefice_total_par_ligne,
                CASE
                    WHEN vi.statut_vente = 'actif' AND vi.quantite_vendue > 0 THEN
                        (vi.prix_unitaire_vente - vi.prix_unitaire_achat)
                    WHEN vi.statut_vente != 'actif' AND vi.quantite_vendue > 0 THEN
                        (0 - vi.prix_unitaire_achat) -- Si inactif, perte du coût d'achat par unité
                    ELSE 0
                END AS benefice_unitaire_produit,
                -- Montant remboursé pour l'article (à récupérer de la table returns si applicable)
                -- Utilise COALESCE pour s'assurer que même si 'returns' n'existe pas ou montant_rembourse est NULL, la valeur est 0
                COALESCE(r.montant_rembourse, 0) AS montant_rembourse_item
            FROM
                vente_items vi
            JOIN
                ventes v ON vi.vente_id = v.id
            LEFT JOIN -- Jointure avec la table returns pour récupérer le montant remboursé
                returns r ON vi.id = r.vente_item_id
            WHERE
                -- Inclure tous les articles, mais le calcul du bénéfice sera conditionnel au statut_vente
                (v.statut_paiement = 'payee_integralement' OR v.statut_paiement = 'paiement_partiel')
                -- Ajout d'une condition pour exclure les ventes dont le statut global est 'annulee'
                AND v.statut_paiement != 'annulee'
        `;
        const queryParams = [];
        let paramIndex = 1;

        const { date } = req.query;

        if (date) {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
                return res.status(400).json({ error: 'Format de date invalide. Utilisez YYYY-MM-DD.' });
            }
            sqlQuery += ` AND DATE(v.date_vente) = $${paramIndex}`;
            queryParams.push(date);
            paramIndex++;
        }

        sqlQuery += ` ORDER BY v.date_vente DESC;`;

        console.log('Backend Benefices: Exécution de la requête SQL:', sqlQuery);
        console.log('Backend Benefices: Paramètres de la requête:', queryParams);

        const itemsResult = await client.query(sqlQuery, queryParams);
        const soldItems = itemsResult.rows;

        console.log('Backend Benefices: Articles de vente trouvés:', soldItems);

        let totalBeneficeGlobal = 0;
        soldItems.forEach(item => {
            // Seuls les articles "actifs" contribuent positivement au bénéfice global
            // Les articles annulés/retournés/rendus ont déjà un bénéfice_total_par_ligne qui est une perte (0 - coût d'achat)
            totalBeneficeGlobal += parseFloat(item.benefice_total_par_ligne);
        });

        console.log('Backend Benefices: Bénéfice total global calculé:', totalBeneficeGlobal);

        res.json({
            sold_items: soldItems,
            total_benefice_global: parseFloat(totalBeneficeGlobal)
        });

    } catch (err) {
        console.error('Erreur lors du calcul des bénéfices:', err);
        res.status(500).json({ error: 'Erreur interne du serveur lors du calcul des bénéfices.' });
    } finally {
        if (client) {
            client.release();
        }
    }
});


// --- DÉMARRAGE DU SERVEUR ---
// Le serveur écoute sur le port fourni par l'environnement (Render) ou 3001 par défaut
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log('✅ Serveur backend lancé'); // Message simplifié ici
  console.log(`🚀 Serveur backend lancé sur http://localhost:${PORT}`);
});
