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
// En production, l'URL doit être l'URL réelle de votre frontend Render.
// Pour le développement local, 'http://localhost:5173' est utilisé.
app.use(cors({
  origin: process.env.NODE_ENV === 'production' ? 'https://vanchoco.app' : 'http://localhost:5173', // CORRECTION : Utilisation de la nouvelle URL du frontend Render
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
app.use('/api/reports', reportsRouter);
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
                JOIN
                    factures f ON v.id = f.vente_id
                WHERE
                    vi.statut_vente = 'actif'
                    AND f.statut_facture = 'payee_integralement'
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
    }
);

// NOUVELLE ROUTE : Annulation complète d'une facture
app.post('/api/factures/:factureId/cancel-full', async (req, res) => {
  const { factureId } = req.params;
  let client;

  try {
    client = await pool.connect();
    await client.query('BEGIN'); // Début de la transaction

    // 1. Récupérer les détails de la facture et de la vente associée
    const factureRes = await client.query(
      `SELECT f.vente_id, vi.produit_id, vi.imei, vi.statut_vente
       FROM factures f
       JOIN ventes v ON f.vente_id = v.id
       JOIN vente_items vi ON v.id = vi.vente_id
       WHERE f.facture_id = $1`,
      [factureId]
    );

    if (factureRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Facture non trouvée.' });
    }

    const venteId = factureRes.rows[0].vente_id;
    const itemsToReturnToStock = factureRes.rows.filter(item => item.statut_vente === 'actif');

    // 2. Mettre à jour le statut de la facture à 'annulee'
    await client.query(
      `UPDATE factures SET statut_facture = 'annulee', date_modification = NOW() WHERE facture_id = $1`,
      [factureId]
    );

    // 3. Mettre à jour le statut de tous les articles de vente associés à 'annule'
    await client.query(
      `UPDATE vente_items SET statut_vente = 'annule', date_modification = NOW() WHERE vente_id = $1`,
      [venteId]
    );

    // 4. Remettre les produits en stock (status 'active', quantite +1)
    for (const item of itemsToReturnToStock) {
      // Vérifier si le produit existe et est unique par IMEI
      const productCheck = await client.query(
        `SELECT id, quantite FROM products WHERE imei = $1`,
        [item.imei]
      );

      if (productCheck.rows.length > 0) {
        // Si le produit existe, le réactiver et augmenter la quantité
        await client.query(
          `UPDATE products SET status = 'active', quantite = quantite + 1, date_modification = NOW() WHERE id = $1`,
          [productCheck.rows[0].id]
        );
      } else {
        // Logique alternative si le produit n'est pas trouvé par IMEI (devrait être rare si le flux est correct)
        console.warn(`Produit avec IMEI ${item.imei} non trouvé pour remise en stock lors de l'annulation de la facture ${factureId}.`);
      }
    }

    await client.query('COMMIT'); // Fin de la transaction
    res.status(200).json({ message: `Facture ${factureId} annulée avec succès. Les mobiles ont été remis en stock.` });

  } catch (err) {
    if (client) {
      await client.query('ROLLBACK'); // Annuler la transaction en cas d'erreur
    }
    console.error('Erreur lors de l\'annulation complète de la facture:', err);
    res.status(500).json({ error: 'Erreur interne du serveur lors de l\'annulation de la facture.' });
  } finally {
    if (client) {
      client.release();
    }
  }
});


// --- DÉMARRAGE DU SERVEUR ---
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log('✅ Connexion à la base de données réussie (vérifiée dans db.js)');
  console.log(`🚀 Serveur backend lancé sur http://localhost:${PORT}`);
});
