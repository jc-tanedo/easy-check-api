'use strict';

const _ = require('lodash');
const axios = require('axios');
const nodeImeiClass = require('node-imei');
const nodeImei = new nodeImeiClass();

const config = require('../../config');
const crypto = require('../../utils/crypto');

module.exports = {
    requestBalance,
};

function requestBalance(accountId, imei = null) {
    imei = imei || nodeImei.random().toString();
    const encImei = crypto.encrypt(Buffer.from('02:00:00:00:00:00' + imei).toString('utf8') + config.idPadding, config.idPassPhrase);

    const encAccountId = crypto.encrypt(JSON.stringify({ AccountObuID: accountId }) + config.contentPadding, config.contentPassPhrase);

    const data = JSON.stringify({ Content: encAccountId });
    const headers = {
        ID: encImei,
        AppVersion: '2.0',
        'Content-Length': data.length,
        'Content-Type': 'application/json',
    };

    return axios({ method: 'post', url: config.easytripUrl, data, headers })
        .then(response => {
            const data = JSON.parse(JSON.stringify(response.data));
            if (data.Return.Result) {
                let plain = JSON.parse(crypto.decrypt(data.Return.Result, config.contentPassPhrase));

                plain = _.mapKeys(plain, (v, k) => _.camelCase(k));
                plain.customerInfo = _.map(plain.customerInfo, info => _.mapKeys(info, (v, k) => _.camelCase(k)));
                plain.reloadInfo = _.map(plain.reloadInfo, info => _.mapKeys(info, (v, k) => _.camelCase(k)));

                return plain;
            }

            return Promise.reject(new Error('No data'));
        });
}
