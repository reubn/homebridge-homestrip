import {exec} from 'child_process'
import tinycolor from 'tinycolor2'
import Queue from 'promise-queue'

import colourCube from './colourCube'

const dispatchPath = `${__dirname}/dispatch.py`

export default ({Service, Characteristic}) =>
  class HomeStripAccessory {
    constructor(log, {name='LED Controller', setup='RGBW', port=5577, ip, purewhite=false, manufacturer='ACME Ltd', model='HomeStrip LED Controller', serialNumber='123456789'}){
      this.log = log

      this.name = name
      this.setup = setup
      this.port = port
      this.ip = ip
      this.purewhite = purewhite

      this.manufacturer = manufacturer
      this.model = model
      this.serialNumber = serialNumber

      this.queue = new Queue(1, Infinity)

      this.state = {
        on: null,
        colour: {
          remote: tinycolor(),
          local: tinycolor()
        },
        brightness: 100
      }

      this.refreshState({initial: true}).then(() => this.changeColourIfNeeded())
    }

    getServices(){
      const informationService = new Service.AccessoryInformation()
      .setCharacteristic(Characteristic.Manufacturer, this.manufacturer)
      .setCharacteristic(Characteristic.Model, this.model)
      .setCharacteristic(Characteristic.SerialNumber, this.serialNumber)

      const staticService = new Service.Lightbulb('Static Colour')

      staticService
      .getCharacteristic(Characteristic.On)
      .on('get', callback => this.getPower().then(a => callback(null, a)))
      .on('set', (value, callback) => this.setPower(value).then(a => callback(null, a)))

      staticService
      .addCharacteristic(new Characteristic.Hue())
      .on('get', callback => this.getHue().then(a => callback(null, a)))
      .on('set', (value, callback) => this.setHue(value).then(a => callback(null, a)))

      staticService
      .addCharacteristic(new Characteristic.Saturation())
      .on('get', callback => this.getSaturation().then(a => callback(null, a)))
      .on('set', (value, callback) => this.setSaturation(value).then(a => callback(null, a)))

      staticService
      .addCharacteristic(new Characteristic.Brightness())
      .on('get', callback => this.getBrightness().then(a => callback(null, a)))
      .on('set', (value, callback) => this.setBrightness(value).then(a => callback(null, a)))

      // const fadeService = new Service.Fan('Colour Fade')
      //
      // fadeService
      // .getCharacteristic(Characteristic.On)
      // .on('get', callback => this.getPower().then(a => callback(null, a)))
      // .on('set', (value, callback) => this.setPower(value).then(a => callback(null, a)))
      //
      // fadeService
      // .getCharacteristic(Characteristic.RotationSpeed)
      // .on('get', callback => this.getBrightness().then(a => callback(null, a)))
      // .on('set', (value, callback) => this.setBrightness(value).then(a => callback(null, a)))

      return [informationService, staticService/*, fadeService*/]
    }

    indentify(a){a()}

    constructParameters({type, payload}){
      const conversions = {
        info: () => '-i',
        power: on => {
          console.log('L ==>', on ? '🔆' : '❌️', '━━ Set OnOff State')
          return on ? '--on' : '--off'
        },
        colour: ({colour}) => {
          console.log('L ==>', colourCube(colour), '━━ Set Colour')

          const {r, g, b} = colour.toRgb()
          return `-x ${this.setup} -c${r},${g},${b}`
        }
      }
      return conversions[type](payload)
    }

    dispatch(command){
      return new Promise((resolve, reject) => exec(`${dispatchPath} ${this.ip} ${this.constructParameters(command)}`, {timeout: 3000}, (error, stdout) => error ? reject(error) : resolve(stdout)))
      .catch(error => {
        if(error.killed) return 'TIMEOUT'
        console.error('Dispatch Error: ', error)
        return 'ERROR'
      })
    }

    refreshState({initial=false}={}){
      return this.dispatch({type: 'info'})
            .then(response => {
              const on = response.includes('ON')
              const [colourReturned, r, g, b] = /\((\d+?), (\d+?), (\d+?)\)/g.exec(response) || []
              const colour = tinycolor({r, g, b})

              console.log(on ? '🔆' : '❌', '<== R ┳')
              console.log('        ┣━━ Update from Remote')
              console.log(colourReturned ? colourCube(colour) : '', '<== R ┻')

              this.state.on = on
              if(!colourReturned) return this.state

              if(initial) this.state.colour.local = tinycolor({...colour.toHsl(), l: 50})
              this.state.colour.remote = colour

              return this.state
            })
    }

    changeColourIfNeeded(){
      return this.refreshState()
      .then(state => {
        const adjustedColour = this.adjustColours({colour: state.colour.local, brightness: state.brightness})
        const needToChange = !tinycolor.equals(adjustedColour, state.colour.remote)

        console.log(colourCube(adjustedColour), needToChange ? '!==' : '===', colourCube(state.colour.remote), '━━ Duplicate Check')

        return needToChange
        ? this.dispatch({type: 'colour', payload: {colour: adjustedColour}}).then(() => this.refreshState().then(() => console.log('AFTER')))
        : Promise.resolve()
      })
    }

    adjustColours({colour, brightness}){
      const {r, g, b} = colour.toRgb()
      return tinycolor({r: Math.round(r * 0.01 * brightness), g: Math.round(g * 0.01 * brightness), b: Math.round(b * 0.01 * brightness)})
    }

    getPower(){
      return this.refreshState()
      .then(({on}) => on)
    }

    setPower(payload){
      return this.dispatch({type: 'power', payload})
      .then(() => this.refreshState())
    }

    getHue(){
      // return this.refreshState()
      // .then(({colour: {remote}}) => remote.toHsl().h)
      return Promise.resolve(this.state.colour.remote.toHsl().h)
    }

    setHue(payload){
      this.state.colour.local = tinycolor({...this.state.colour.local.toHsl(), h: payload})
      return this.changeColourIfNeeded()
    }

    getSaturation(){
      // return this.refreshState()
      // .then(({colour: {remote: {s}}}) => s)
      return Promise.resolve(this.state.colour.remote.toHsl().s)
    }

    setSaturation(payload){
      this.state.colour.local = tinycolor({...this.state.colour.local.toHsl(), s: payload})
      return this.changeColourIfNeeded()
    }

    getBrightness(){
      // return this.refreshState()
      // .then(({brightness}) => brightness)
      return Promise.resolve(this.state.brightness)
    }

    setBrightness(payload){
      this.state.brightness = payload
      return this.changeColourIfNeeded()
    }
  }
