'use strict';

const config = {
    easytripUrl: 'http://www.easytripcustomer.ph/ESCCB_WS/ESCCB.aspx/P01',

    idPassPhrase: process.env.ID_PASS || '',
    contentPassPhrase: process.env.CONTENT_PASS || '',

    idPadding: new Array(32).fill(' ').join(''),
    contentPadding: '\u0001',
}

module.exports = config;