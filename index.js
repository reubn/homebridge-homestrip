require('babel-register')

const makeHomeStripAccessory = require('./HomeStripAccessory').default

module.exports = (homebridge, {hap: {Service, Characteristic}}=homebridge) => homebridge.registerAccessory('homebridge-homestrip', 'HomeStrip', makeHomeStripAccessory({Service, Characteristic}), false)
