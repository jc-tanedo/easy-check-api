const express = require('express');
const app = express();
const port = 7777;

const easytripController = require('./controllers/easytrip');

app.get('/check-balance', easytripController.checkBalance);

app.listen(port, () => console.log(`Listening on port ${port}!`));
