import {exec} from 'child_process'
import tinycolor from 'tinycolor2'
import Queue from 'promise-queue'

import colourCube from './colourCube'
import onOffIndicator from './onOffIndicator'

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

      this.queue = new Queue(1, 5)

      this.state = {
        local: {
          on: null,
          colour: tinycolor()
        },
        remote: {
          on: null,
          colour: tinycolor()
        },
        brightness: 100
      }

      this.refreshState({initial: true}).then(() => this.changeColourIfNeeded())
    }

    getServices(){
      const wrap = (handler, name='misc') => (a, b) => {
        const [callback, value] = typeof a === 'function' ? [a, b] : [b, a]
        this.queue.add(() => {
          console.log(`━━━━━━━━━━━━━━━━━━━━${name.toUpperCase()}━━━━━━━━━━━━━━━━━━━━`)
          return handler.call(this, value)
          .then(res => {
            console.log(`━━━━━━━━━━━━━━━━━━━━END ${name.toUpperCase()}━━━━━━━━━━━━━━━━━━━━`)
            callback(null, res)
          })
          .catch(error => callback(error))
        }
        )
      }

      const informationService = new Service.AccessoryInformation()
      .setCharacteristic(Characteristic.Manufacturer, this.manufacturer)
      .setCharacteristic(Characteristic.Model, this.model)
      .setCharacteristic(Characteristic.SerialNumber, this.serialNumber)

      const staticService = new Service.Lightbulb('Static Colour')

      staticService
      .getCharacteristic(Characteristic.On)
      .on('get', wrap(this.getPower, 'get power'))
      .on('set', wrap(this.setPower, 'set power'))

      staticService
      .addCharacteristic(new Characteristic.Hue())
      .on('get', wrap(this.getHue, 'get hue'))
      .on('set', wrap(this.setHue, 'set hue'))

      staticService
      .addCharacteristic(new Characteristic.Saturation())
      .on('get', wrap(this.getSaturation, 'get saturation'))
      .on('set', wrap(this.setSaturation, 'set saturation'))

      staticService
      .addCharacteristic(new Characteristic.Brightness())
      .on('get', wrap(this.getBrightness, 'get brightness'))
      .on('set', wrap(this.setBrightness, 'set brightness'))

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

              console.log(onOffIndicator(on), '<== R ┳')
              console.log('        ┣━━ Update from Remote')
              console.log(colourReturned ? colourCube(colour) : '?', '<== R ┻')

              this.state.remote.on = on
              if(!colourReturned) return this.state

              if(initial) this.state.local.colour = tinycolor({...colour.toHsl(), l: 50})
              this.state.remote.colour = colour

              return this.state
            })
    }

    changePowerIfNeeded(){
      return this.refreshState()
      .then(state => {
        const needToChange = state.local.on !== state.remote.on

        console.log(onOffIndicator(state.local.on), needToChange ? '!==' : '===', onOffIndicator(state.remote.on), '━━ Duplicate Check')

        return needToChange
        ? this.dispatch({type: 'power', payload: state.local.on})
          .then(() => this.refreshState())
        : Promise.resolve()
      })
    }

    changeColourIfNeeded(){
      return this.refreshState()
      .then(state => {
        const adjustedColour = this.adjustColours({colour: state.local.colour, brightness: state.brightness})
        const needToChange = !tinycolor.equals(adjustedColour, state.remote.colour)

        console.log(colourCube(adjustedColour), needToChange ? '!==' : '===', colourCube(state.remote.colour), '━━ Duplicate Check')

        return needToChange
        ? this.dispatch({type: 'colour', payload: {colour: adjustedColour}})
          .then(() => this.refreshState())
        : Promise.resolve()
      })
    }

    adjustColours({colour, brightness}){
      const {r, g, b} = colour.toRgb()
      return tinycolor({r: Math.round(r * 0.01 * brightness), g: Math.round(g * 0.01 * brightness), b: Math.round(b * 0.01 * brightness)})
    }

    getPower(){
      return this.refreshState()
      .then(({remote: {on}}) => on)
    }

    setPower(payload){
      this.state.local.on = !!payload
      return this.changePowerIfNeeded()
    }

    getHue(){
      return this.refreshState()
      .then(({remote: {colour}}) => colour.toHsl().h)
    }

    setHue(payload){
      this.state.local.colour = tinycolor({...this.state.local.colour.toHsl(), h: payload})
      return this.changeColourIfNeeded()
    }

    getSaturation(){
      return this.refreshState()
      .then(({remote: {colour}}) => colour.toHsl().s)
    }

    setSaturation(payload){
      this.state.local.colour = tinycolor({...this.state.local.colour.toHsl(), s: payload})
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
