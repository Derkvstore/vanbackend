    // backend/db.js
    const { Pool } = require('pg');
    const dotenv = require('dotenv');

    // Charge les variables d'environnement du fichier .env
    // Ceci est utile pour le développement local.
    // En production (sur Render), les variables sont injectées directement par l'environnement.
    dotenv.config();

    // La configuration du pool de connexions à la base de données PostgreSQL
    const pool = new Pool({
      user: process.env.DB_USER,        // Nom d'utilisateur de la base de données
      host: process.env.DB_HOST,        // Hôte de la base de données (sur Render, ce sera une URL interne)
      database: process.env.DB_NAME,    // Nom de la base de données
      password: process.env.DB_PASSWORD, // Mot de passe de la base de données
      port: process.env.DB_PORT,        // Port de la base de données (généralement 5432)
      // *** TRÈS IMPORTANT pour Render : Activer SSL en production ***
      // Render utilise des connexions SSL pour ses bases de données.
      // `rejectUnauthorized: false` est souvent nécessaire pour les fournisseurs de cloud
      // car ils peuvent utiliser des certificats auto-signés ou non vérifiables par défaut.
      // Cette condition s'assure que SSL est activé uniquement en mode production.
      ssl: process.env.NODE_ENV === 'production' ? {
        rejectUnauthorized: false
      } : false // Désactivé en développement local
    });

    // Test de la connexion au démarrage de l'application
    // Cela permet de vérifier que les identifiants de la base de données sont corrects.
    pool.connect()
      .then(client => { // Utilise 'client' pour s'assurer que la connexion est bien établie
        console.log('✅ Connexion à la base de données PostgreSQL réussie !');
        client.release(); // Libère le client pour le pool après le test
      })
      .catch(err => {
        console.error('❌ Erreur de connexion à la base de données PostgreSQL:', err.stack);
        // En production, vous pourriez vouloir quitter le processus ici si la connexion DB est critique
        // process.exit(1);
      });

    // Exportez le pool de connexions et une fonction 'query' pratique
    // Cela permet aux autres fichiers d'importer et d'utiliser facilement la base de données.
    module.exports = {
      pool: pool, // Exporte l'objet pool directement
      query: (text, params) => pool.query(text, params) // Exporte une fonction utilitaire pour exécuter des requêtes
    };
    