const bcrypt = require('bcrypt');

bcrypt.hash('Wara0103', 10).then(hash => {
  console.log('Hash généré :', hash);
});
