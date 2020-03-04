'use strict';

const axios = require('axios');

const config = require('../../config');
const crypto = require('../../utils/crypto');

module.exports = {
    requestBalance,
};

function requestBalance(accountId, deviceId) {
    const encDeviceId = crypto.encrypt(Buffer.from('02:00:00:00:00:00' + deviceId).toString('utf8') + config.idPadding, config.idPassPhrase);
    const encAccountId = crypto.encrypt(JSON.stringify({ AccountObuID: accountId }) + config.contentPadding, config.contentPassPhrase);

    const data = JSON.stringify({ Content: encAccountId });
    const headers = {
        ID: encDeviceId,
        AppVersion: '2.0',
        'Content-Length': data.length,
        'Content-Type': 'application/json',
    };

    return axios({ method: 'post', url: config.easytripUrl, data, headers })
        .then(response => {
            const data = JSON.parse(JSON.stringify(response.data));
            if (data.Return.Result) {
                return JSON.parse(crypto.decrypt(data.Return.Result, config.contentPassPhrase));
            }

            throw new Error('No data');
        });
}
