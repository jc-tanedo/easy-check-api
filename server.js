const express = require('express');
const app = express();
const port = 7777;
const cors = require('cors');

const easytripController = require('./controllers/easytrip');

var corsOptions = {
    origin: function (origin, callback) {
        if (/https?:\/\/.*\.?jczr.dev/.test(origin)) {
            callback(null, true)
        } else {
            callback(new Error('Not allowed by CORS'))
        }
    },
    optionsSuccessStatus: 200 // some legacy browsers (IE11, various SmartTVs) choke on 204
}

app.options('/check-balance', cors(corsOptions));
app.get('/check-balance', cors(corsOptions), easytripController.checkBalance);

app.listen(port, () => console.log(`Listening on port ${port}!`));
