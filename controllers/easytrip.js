'use strict';

const easytripService = require('../service/easytrip');

module.exports = {
    checkBalance,
};

function checkBalance(req, res) {
    const { id, imei = null } = req.query;

    if (!id) {
        return res.status(400).send({ error: 'Missing required parameters' })
    }

    easytripService.requestBalance(id, imei)
        .then(userInfo => res.send(userInfo))
        .catch(err => console.log(err) && Promise.reject())
        .catch(() => res.status(400).send({ error: 'Something went wrong, make sure your parameters are correct and/or try again later' }));
}