import {exec} from 'child_process'
import tinycolor from 'tinycolor2'

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

      this.state = {
        on: null,
        colour: {
          remote: {},
          local: {}
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

      const lightbulbService = new Service.Lightbulb(this.name)

      lightbulbService
      .getCharacteristic(Characteristic.On)
      .on('get', callback => this.getPower().then(a => callback(null, a)))
      .on('set', (value, callback) => this.setPower(value).then(a => callback(null, a)))

      lightbulbService
      .addCharacteristic(new Characteristic.Hue())
      .on('get', callback => this.getHue().then(a => callback(null, a)))
      .on('set', (value, callback) => this.setHue(value).then(a => callback(null, a)))

      lightbulbService
      .addCharacteristic(new Characteristic.Saturation())
      .on('get', callback => this.getSaturation().then(a => callback(null, a)))
      .on('set', (value, callback) => this.setSaturation(value).then(a => callback(null, a)))

      lightbulbService
      .addCharacteristic(new Characteristic.Brightness())
      .on('get', callback => this.getBrightness().then(a => callback(null, a)))
      .on('set', (value, callback) => this.setBrightness(value).then(a => callback(null, a)))

      return [informationService, lightbulbService]
    }

    indentify(a){a()}

    constructParameters({type, payload}){
      const conversions = {
        info: () => '-i',
        power: on => on ? '--on' : '--off',
        colour: ({colour, brightness}) => {
          const {r, g, b} = this.adjustColours({colour, brightness}).toRgb()
          return `-x ${this.setup} -c${r},${g},${b}`
        }
      }
      return conversions[type](payload)
    }

    dispatch(command){
      return new Promise((resolve, reject) => exec(`${dispatchPath} ${this.ip} ${this.constructParameters(command)}`, {timeout: 1000}, (error, stdout) => error ? reject(error) : resolve(stdout)))
    }

    refreshState({initial=false}={}){
      return this.dispatch({type: 'info'})
            .then(response => {
              console.log(response)
              const isOn = response.includes('ON')
              const [colourReturned, ...rgb] = /\((\d+?), (\d+?), (\d+?)\)/g.exec(response) || []
              const colour = tinycolor(rgb)

              this.state.on = isOn

              if(!colourReturned) return this.state

              if(initial) this.state.colour.local = tinycolor({...colour.toHsl(), l: 50})
              this.state.colour.remote = colour

              return this.state
            })
    }

    changeColourIfNeeded(){
      return this.refreshState()
      .then(state =>
        !tinycolor.equals(this.adjustColours({colour: state.colour.local, brightness: state.brightness}), state.colour.remote)
        ? this.dispatch({type: 'colour', payload: {colour: state.colour.local, brightness: state.brightness}})
        : Promise.resolve()
      )
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
      return this.refreshState()
      .then(({colour: {remote}}) => remote.toHsl().h)
    }

    setHue(payload){
      this.state.colour.local = tinycolor({...this.state.colour.local.toHsl(), h: payload})
      return this.changeColourIfNeeded()
    }

    getSaturation(){
      return this.refreshState()
      .then(({colour: {remote: {s}}}) => s)
    }

    setSaturation(payload){
      this.state.colour.local = tinycolor({...this.state.colour.local.toHsl(), s: payload})
      return this.changeColourIfNeeded()
    }

    getBrightness(){
      return this.refreshState()
      .then(({brightness}) => brightness)
    }

    setBrightness(payload){
      this.state.brightness = payload
      return this.changeColourIfNeeded()
    }
  }
