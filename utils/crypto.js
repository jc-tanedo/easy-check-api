const crypto = require('crypto');
const _ = require('lodash');
const rj = require('js-rijndael');

module.exports = {
    encrypt,
    decrypt,
    hexToBytes,
    netByteToHex,
};

function encrypt(plainText, passPhrase) {
    const plainBytes = [].slice.apply(Buffer.from(plainText));

    const keyEntropy = [].slice.apply(crypto.randomBytes(32));
    const encryptEntropy = [].slice.apply(crypto.randomBytes(32));

    const keyBytes = crypto.pbkdf2Sync(Buffer.from(passPhrase), Buffer.from(keyEntropy), 1000, 256, 'sha1');
    const key = keyBytes.toString('hex').substr(0, 64).toUpperCase();

    const encrypted = rj.encrypt(plainBytes, encryptEntropy, hexToBytes(key), 'rijndael-256', 'cbc');

    return Buffer.from(_.flatten([keyEntropy, encryptEntropy, encrypted])).toString('base64');
}

function decrypt(encrypted, passPhrase) {
    const decodedBytes = Buffer.from(encrypted, 'base64');

    const salt = _.map(_.range(0, 32), i => netByteToHex(decodedBytes[i])).join('');
    const iv = _.map(_.range(32, 64), i => netByteToHex(decodedBytes[i])).join('');
    const encryptedContent = _.map(_.range(64, decodedBytes.length), i => netByteToHex(decodedBytes[i])).join('');

    const keyBytes = crypto.pbkdf2Sync(Buffer.from(passPhrase), Buffer.from(salt, 'hex'), 1000, 256, 'sha1');
    const key = keyBytes.toString('hex').substr(0, 64).toUpperCase();

    const plain = rj.decrypt(hexToBytes(encryptedContent), hexToBytes(iv), hexToBytes(key), 'rijndael-256', 'cbc');

    return Buffer.from(plain).toString('utf8').replace(/\u001f/g, '');
}

function hexToBytes(hex) {
    return [].slice.apply(Buffer.from(hex, 'hex'));
}

var hexChar = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "A", "B", "C", "D", "E", "F"];
function netByteToHex(byte) {
    return hexChar[(byte >> 4) & 0x0f] + hexChar[byte & 0x0f];
}
