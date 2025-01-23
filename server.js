const express = require('express');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());

app.get('/', (req, res) => {
  res.send('E-Certificate service is up and running.');
});

app.listen(PORT, () => {
  console.log(`Server is listening on port ${PORT}`);
});
