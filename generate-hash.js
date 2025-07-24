const bcrypt = require('bcrypt');

bcrypt.hash('Joker7703', 10).then(hash => {
  console.log('Hash généré :', hash);
});
