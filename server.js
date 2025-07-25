// backend/server.js
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');

// Charge les variables d'environnement du fichier .env si l'environnement n'est pas 'production'
// En production (sur Render), les variables seront injectées directement par Render.
if (process.env.NODE_ENV !== 'production') {
  dotenv.config();
}

// Importe la connexion à la base de données (pool et query)
// Assurez-vous que le chemin est correct par rapport à server.js
const { pool, query } = require('./db');

// Importe les fonctions spécifiques d'authentification
const { registerUser, loginUser } = require('./auth'); // Assurez-vous que ce fichier existe et exporte ces fonctions

// Importe les routeurs pour les différentes entités
// Vérifiez que ces chemins sont corrects par rapport à l'emplacement de server.js
const clientsRoutes = require('./clients');
const productRoutes = require('./products');
const ventesRoutes = require('./ventes');
const reportsRouter = require('./reports');
const returnsRouter = require('./returns');
const remplacerRouter = require('./remplacements');
const fournisseursRoutes = require('./fournisseurs');
const facturesRoutes = require('./factures');
const specialOrdersRoutes = require('./specialOrders'); // Route pour les commandes spéciales

const app = express();

// Configuration CORS
// Pour le déploiement, il est recommandé de spécifier l'origine de votre frontend.
// Si votre frontend est aussi sur Render, utilisez son URL Render.
// Pour le développement local, gardez 'http://localhost:5173'.
// Pour une flexibilité initiale en déploiement, vous pouvez autoriser toutes les origines (moins sécurisé pour la production finale).
app.use(cors({
  // CORRECTION ICI : L'URL réelle de votre frontend sur Render
  origin: process.env.NODE_ENV === 'production' ? 'https://choco-frontend-app.onrender.com' : 'http://localhost:5173',
  credentials: true
}));

// Middleware pour parser les requêtes JSON
app.use(express.json());

// --- ROUTES D'AUTHENTIFICATION ---
app.post('/api/login', loginUser);
app.post('/api/register', registerUser); // Si vous avez une route d'enregistrement

// --- ROUTES POUR LES AUTRES RESSOURCES ---
// Utilisez app.use() pour monter les routeurs
app.use('/api/clients', clientsRoutes);
app.use('/api/products', productRoutes);
app.use('/api/ventes', ventesRoutes);
app.use('/api/reports', reportsRouter);
app.use('/api/returns', returnsRouter);
app.use('/api/remplacements', remplacerRouter);
app.use('/api/fournisseurs', fournisseursRoutes);
app.use('/api/factures', facturesRoutes);
app.use('/api/special-orders', specialOrdersRoutes); // Route pour les commandes spéciales

// --- NOUVELLE ROUTE GET POUR CALCULER LES BÉNÉFICES ---
app.get('/api/benefices', async (req, res) => {
    let client; // Déclare la variable client pour le pool de connexion
    try {
        client = await pool.connect(); // Obtient un client du pool
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
                COALESCE(v.montant_total, 0) AS total_negotiated_sale_price,
                vi.prix_unitaire_vente AS original_unit_sale_price,
                COALESCE((SELECT SUM(sub_vi.prix_unitaire_vente * sub_vi.quantite_vendue)
                 FROM vente_items sub_vi WHERE sub_vi.vente_id = vi.vente_id), 0) AS total_original_sale_value,
                (CASE
                    WHEN COALESCE((SELECT SUM(sub_vi.prix_unitaire_vente * sub_vi.quantite_vendue) FROM vente_items sub_vi WHERE sub_vi.vente_id = vi.vente_id), 0) = 0 THEN 0
                    ELSE COALESCE(v.montant_total, 0) * (vi.prix_unitaire_vente * vi.quantite_vendue) / COALESCE((SELECT SUM(sub_vi.prix_unitaire_vente * sub_vi.quantite_vendue) FROM vente_items sub_vi WHERE sub_vi.vente_id = vi.vente_id), 0)
                END) AS actual_revenue_per_line,
                (CASE
                    WHEN COALESCE((SELECT SUM(sub_vi.prix_unitaire_vente * sub_vi.quantite_vendue) FROM vente_items sub_vi WHERE sub_vi.vente_id = vi.vente_id), 0) = 0 THEN (0 - (vi.prix_unitaire_achat * vi.quantite_vendue))
                    ELSE (COALESCE(v.montant_total, 0) * (vi.prix_unitaire_vente * vi.quantite_vendue) / COALESCE((SELECT SUM(sub_vi.prix_unitaire_vente * sub_vi.quantite_vendue) FROM vente_items sub_vi WHERE sub_vi.vente_id = vi.vente_id), 0)) - (vi.prix_unitaire_achat * vi.quantite_vendue)
                END) AS benefice_total_par_ligne,
                (CASE
                    WHEN vi.quantite_vendue = 0 THEN 0
                    WHEN COALESCE((SELECT SUM(sub_vi.prix_unitaire_vente * sub_vi.quantite_vendue) FROM vente_items sub_vi WHERE sub_vi.vente_id = vi.vente_id), 0) = 0 THEN (0 - vi.prix_unitaire_achat)
                    ELSE ((COALESCE(v.montant_total, 0) * (vi.prix_unitaire_vente * vi.quantite_vendue) / COALESCE((SELECT SUM(sub_vi.prix_unitaire_vente * sub_vi.quantite_vendue) FROM vente_items sub_vi WHERE sub_vi.vente_id = vi.vente_id), 0)) / vi.quantite_vendue) - vi.prix_unitaire_achat
                END) AS benefice_unitaire_produit
            FROM
                vente_items vi
            JOIN
                ventes v ON vi.vente_id = v.id
            LEFT JOIN -- CHANGEMENT CLÉ : Utilisation de LEFT JOIN pour inclure les ventes sans facture
                factures f ON v.id = f.vente_id
            WHERE
                vi.statut_vente = 'actif'
                AND (
                    (f.facture_id IS NOT NULL AND f.statut_facture = 'payee_integralement') -- Ventes liées à une facture spéciale entièrement payée
                    OR
                    (f.facture_id IS NULL AND COALESCE(v.montant_paye, 0) >= COALESCE(v.montant_total, 0) AND v.is_facture_speciale = FALSE) -- Ventes en détail entièrement payées
                )
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

        const itemsResult = await client.query(sqlQuery, queryParams);
        const soldItems = itemsResult.rows;

        let totalBeneficeGlobal = 0;
        soldItems.forEach(item => {
            totalBeneficeGlobal += parseFloat(item.benefice_total_par_ligne);
        });

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
