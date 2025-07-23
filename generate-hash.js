const bcrypt = require('bcrypt');

bcrypt.hash('', 10).then(hash => {
  console.log('Hash généré :', hash);
});
