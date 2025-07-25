// backend/server.js
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');

// Charge les variables d'environnement du fichier .env UNIQUEMENT si l'environnement n'est PAS 'production'.
// Sur Render (en production), les variables seront injectées directement par Render.
if (process.env.NODE_ENV !== 'production') {
  dotenv.config();
}

// Importez la connexion à la base de données (pool)
const { pool } = require('./db');

// Importez les fonctions spécifiques de auth.js de manière destructurée
const { registerUser, loginUser } = require('./auth');

// Assurez-vous que ces chemins sont corrects par rapport à l'emplacement de server.js
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

// Configuration CORS : Utilise l'URL de votre frontend Render en production, ou localhost en développement.
app.use(cors({
  origin: process.env.NODE_ENV === 'production' ? 'https://choco-frontend-app.onrender.com' : 'http://localhost:5173', // REMPLACEZ PAR L'URL DE VOTRE FRONTEND RENDER
  credentials: true
}));

app.use(express.json());

// --- ROUTES ---
// Pour l'authentification, utilisez les fonctions directement avec app.post()
app.post('/api/login', loginUser);
app.post('/api/register', registerUser); // Si vous avez une route d'enregistrement

// Utilisez app.use() pour les autres routeurs qui exportent "router"
// Vérifiez que les chemins d'accès ici correspondent à la structure de vos fichiers
app.use('/api/clients', clientsRoutes);
app.use('/api/products', productRoutes);
app.use('/api/ventes', ventesRoutes);
app.use('/api/reports', reportsRouter);
app.use('/api/returns', returnsRouter);
app.use('/api/remplacements', remplacerRouter);
app.use('/api/fournisseurs', fournisseursRoutes);
app.use('/api/factures', facturesRoutes);
app.use('/api/special-orders', specialOrdersRoutes); // NOUVELLE ROUTE pour les commandes spéciales

// Nouvelle route GET pour calculer les bénéfices totaux et détaillés
app.get('/api/benefices', async (req, res) => {
    let client; // Déclarez la variable client ici
    try {
        client = await pool.connect(); // Initialisez client ici
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
                vi.statut_vente, -- Inclure le statut de l'article de vente
                COALESCE(vi.montant_rembourse_item, 0) AS montant_rembourse_item, -- Inclure le montant remboursé pour l'article

                -- Calculer le revenu proportionnel pour cet article basé sur le total négocié de la vente
                (CASE
                    WHEN COALESCE((SELECT SUM(sub_vi.prix_unitaire_vente * sub_vi.quantite_vendue) FROM vente_items sub_vi WHERE sub_vi.vente_id = vi.vente_id), 0) = 0 THEN 0
                    ELSE COALESCE(v.montant_total, 0) * (vi.prix_unitaire_vente * vi.quantite_vendue) / COALESCE((SELECT SUM(sub_vi.prix_unitaire_vente * sub_vi.quantite_vendue) FROM vente_items sub_vi WHERE sub_vi.vente_id = vi.vente_id), 0)
                END) AS proportional_revenue,

                -- Calculer le Bénéfice Total par Ligne en fonction du statut de l'article
                (CASE
                    WHEN vi.statut_vente = 'annule' THEN 0 -- Si annulé, pas de bénéfice/perte pour cet article
                    WHEN vi.statut_vente = 'retourne' THEN
                        (
                            (CASE
                                WHEN COALESCE((SELECT SUM(sub_vi.prix_unitaire_vente * sub_vi.quantite_vendue) FROM vente_items sub_vi WHERE sub_vi.vente_id = vi.vente_id), 0) = 0 THEN 0
                                ELSE COALESCE(v.montant_total, 0) * (vi.prix_unitaire_vente * vi.quantite_vendue) / COALESCE((SELECT SUM(sub_vi.prix_unitaire_vente * sub_vi.quantite_vendue) FROM vente_items sub_vi WHERE sub_vi.vente_id = vi.vente_id), 0)
                            END)
                            - (vi.prix_unitaire_achat * vi.quantite_vendue)
                        ) - COALESCE(vi.montant_rembourse_item, 0) -- Soustraire le montant remboursé
                    ELSE -- 'actif' ou tout autre statut qui implique une vente réussie pour le calcul du bénéfice
                        (CASE
                            WHEN COALESCE((SELECT SUM(sub_vi.prix_unitaire_vente * sub_vi.quantite_vendue) FROM vente_items sub_vi WHERE sub_vi.vente_id = vi.vente_id), 0) = 0 THEN (0 - (vi.prix_unitaire_achat * vi.quantite_vendue))
                            ELSE (COALESCE(v.montant_total, 0) * (vi.prix_unitaire_vente * vi.quantite_vendue) / COALESCE((SELECT SUM(sub_vi.prix_unitaire_vente * sub_vi.quantite_vendue) FROM vente_items sub_vi WHERE sub_vi.vente_id = vi.vente_id), 0)) - (vi.prix_unitaire_achat * vi.quantite_vendue)
                        END)
                END) AS benefice_total_par_ligne,

                -- Calculer le Bénéfice Unitaire Produit en fonction du statut de l'article
                (CASE
                    WHEN vi.statut_vente = 'annule' THEN 0
                    WHEN vi.statut_vente = 'retourne' THEN
                        (
                            (CASE
                                WHEN vi.quantite_vendue = 0 THEN 0
                                WHEN COALESCE((SELECT SUM(sub_vi.prix_unitaire_vente * sub_vi.quantite_vendue) FROM vente_items sub_vi WHERE sub_vi.vente_id = vi.vente_id), 0) = 0 THEN 0
                                ELSE (COALESCE(v.montant_total, 0) * (vi.prix_unitaire_vente * vi.quantite_vendue) / COALESCE((SELECT SUM(sub_vi.prix_unitaire_vente * sub_vi.quantite_vendue) FROM vente_items sub_vi WHERE sub_vi.vente_id = vi.vente_id), 0)) / vi.quantite_vendue
                            END)
                            - vi.prix_unitaire_achat
                        ) - (COALESCE(vi.montant_rembourse_item, 0) / vi.quantite_vendue) -- Soustraire le remboursement par unité
                    ELSE -- 'actif' ou tout autre statut qui implique une vente réussie pour le calcul du bénéfice
                        (CASE
                            WHEN vi.quantite_vendue = 0 THEN 0
                            WHEN COALESCE((SELECT SUM(sub_vi.prix_unitaire_vente * sub_vi.quantite_vendue) FROM vente_items sub_vi WHERE sub_vi.vente_id = vi.vente_id), 0) = 0 THEN (0 - vi.prix_unitaire_achat)
                            ELSE ((COALESCE(v.montant_total, 0) * (vi.prix_unitaire_vente * vi.quantite_vendue) / COALESCE((SELECT SUM(sub_vi.prix_unitaire_vente * sub_vi.quantite_vendue) FROM vente_items sub_vi WHERE sub_vi.vente_id = vi.vente_id), 0)) / vi.quantite_vendue) - vi.prix_unitaire_achat
                        END)
                END) AS benefice_unitaire_produit
            FROM
                vente_items vi
            JOIN
                ventes v ON vi.vente_id = v.id
            LEFT JOIN -- Utiliser LEFT JOIN pour inclure les articles même si aucune facture correspondante n'est trouvée (bien qu'idéalement il devrait y en avoir une)
                factures f ON v.id = f.vente_id
            WHERE
                f.statut_facture != 'annulee' AND f.statut_facture != 'retour_total' -- Exclure les factures entièrement annulées/retournées
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
app.listen(process.env.PORT || 3001, () => {
  console.log('✅ Serveur backend lancé'); // Message simplifié ici
  console.log(`🚀 Serveur backend lancé sur http://localhost:${process.env.PORT || 3001}`);
});
