    // backend/db.js
    const { Pool } = require('pg');
    const dotenv = require('dotenv');

    // Charge les variables d'environnement du fichier .env UNIQUEMENT si l'environnement n'est PAS 'production'.
    // Sur Render (en production), les variables sont déjà injectées par Render,
    // donc cette ligne sera ignorée, évitant ainsi de charger un .env potentiellement committé par erreur.
    if (process.env.NODE_ENV !== 'production') {
      dotenv.config();
    }

    // La configuration du pool de connexions à la base de données PostgreSQL
    const pool = new Pool({
      user: process.env.DB_USER,        // Nom d'utilisateur de la base de données
      host: process.env.DB_HOST,        // Hôte de la base de données (sur Render, ce sera une URL interne)
      database: process.env.DB_NAME,    // Nom de la base de données
      password: process.env.DB_PASSWORD, // Mot de passe de la base de données
      port: process.env.DB_PORT,        // Port de la base de données (généralement 5432)
      // *** TRÈS IMPORTANT pour Render : Activer SSL en production ***
      // Cette condition s'assure que SSL est activé uniquement en mode production.
      ssl: process.env.NODE_ENV === 'production' ? {
        rejectUnauthorized: false
      } : false // Désactivé en développement local
    });

    // Test de la connexion au démarrage de l'application
    pool.connect()
      .then(client => {
        console.log('✅ Connexion à la base de données PostgreSQL réussie !');
        client.release();
      })
      .catch(err => {
        console.error('❌ Erreur de connexion à la base de données PostgreSQL:', err.stack);
        // En production, vous pourriez vouloir quitter le processus ici si la connexion DB est critique
        // process.exit(1);
      });

    // Exportez le pool de connexions et une fonction 'query' pratique
    module.exports = {
      pool: pool,
      query: (text, params) => pool.query(text, params)
    };
    