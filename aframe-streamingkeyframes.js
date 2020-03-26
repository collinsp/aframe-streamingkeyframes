AFRAME.registerComponent('streamingkeyframes', {
  // define streamingkeyframes attributes and default values
  schema: {
    src:      { default: 'frames/<framenum>.txt' },  // directory where frame data exists
    startFrame: { default: 1 },
    frameDur: { default: 1000 },      // ms we should play each frame
    colorSet0: { default: '#000000,#797979,#ffffff,#860000,#fframeIdx0000,#8c5c00,#ffa800,#827700,#ffframeIdx000,#138600,#18fframeIdx00,#000d72,#0012ff,#7d0070,#fframeIdx00e4' },
    colorSet1: { default: '#797979,#ffffff,#860000,#fframeIdx0000,#8c5c00,#ffa800,#827700,#ffframeIdx000,#138600,#18fframeIdx00,#000d72,#0012ff,#7d0070,#fframeIdx00e4,#000000' },
    collisionColor: { default: '#e7298a' },
    invalidColorDefault: { default: 'pink' },
    parser:   {}
  },

  init: function(){
    const sceneEl = this.el.sceneEl

    sceneEl.addEventListener('playPause', evt => {
      if (this.playState==2) this.playAnimation()
      else this.pauseAnimation()
    })

    sceneEl.addEventListener('setPlayTime', evt => {
      const frame = Math.ceil((this.totalFrames || 100) * evt.detail.weight)
      this.loadFrameNum(frame)
    })
    sceneEl.addEventListener('nextFrame',         _=> this.nextFrame())
    sceneEl.addEventListener('previousFrame',     _=> this.previousFrame())
    sceneEl.addEventListener('increasePlaySpeed', _=> this.setPlaySpeed(this.playSpeed + 1))
    sceneEl.addEventListener('decreasePlaySpeed', _=> this.setPlaySpeed(this.playSpeed - 1))
    sceneEl.addEventListener('nextStyle',         _=> this.nextColorSet())
    sceneEl.addEventListener('prevStyle',         _=> this.prevColorSet())
    sceneEl.addEventListener('resetView',         _=> this.reset())
  },
    
  // called on initial load or when streamingkeyframes element changes
  update: function() {
//console.log('update called')
    if (! this.data.parser) this.data.parser = this.parseSimpleText;
    this.srcTemplate = this.data.src;
    if (this.srcTemplate.indexOf('<framenum>')==-1) {
      if (! /\/$/.test(this.srcTemplate)) this.srcTemplate += '/';
      this.srcTemplate += '<framenum>.txt';
    }

    if (this.data.parser && typeof this.data.parser === 'string')
       this.data.parser = window[this.data.parser]; 
    if (typeof this.data.parser !== "function")
      throw 'streamingkeyframes parser is not a function';

    // init colorSets
    this.colorSets = []
    for (let i=0;i<10;++i) {
      const name = 'colorSet'+i
      if (name in this.data) {
        this.colorSets[i] = this.data[name].split(',');
      }
    }

    this.reset();
  },

  nextColorSet: function() {
    if (this.colorSetIdx == undefined) this.colorSetIdx=-1
    while (true) {
      ++this.colorSetIdx
      if (this.colorSetIdx==10) this.colorSetIdx=0
      if (this.colorSets[this.colorSetIdx]) break
    }
  },
  prevColorSet: function() {
    if (this.colorSetIdx == undefined) this.colorSetIdx=10
    while (true) {
      --this.colorSetIdx
      if (this.colorSetIdx==-1) this.colorSetIdx=9
      if (this.colorSets[this.colorSetIdx]) break
    }
  },

  // restart keyframes
  reset: function() {
//console.log('reset called')
    this.playState = 0;  // 0=buffering,playing=1,paused=2
    this.colorSetIdx = undefined
    this.nextColorSet()
    this.setPlaySpeed(5)
    this.totalFrames = undefined
    this.frameBufferSize=10  // how many keyframes to hold for each particle
    this.frameBackBufferSize = 2 // hold onto this many back frames to facilitate faster rewind
    this.loadedFrames = new Array(this.frameBufferSize)
    this.frameNum = this.data.startFrame
    this.frameNumBeingFetched = undefined
    this.frameTime=0         // ms into the current animation frame
    this.fetchPromise=undefined
    while (this.el.firstChild) this.el.removeChild(this.el.firstChild)
    this.fetchFrame()
  },

  // speed: 1-10
  setPlaySpeed: function(speed) {
    if (speed > 10) speed = 10
    else if (speed < 1) speed = 1
    this.playSpeed = speed
    this.frameDur = Math.ceil(this.data.frameDur / speed)
  },

  // default data parser - each line is in format: "<particleId> <x> <y> <z> <radius> <colorIdx>"
  parseSimpleText: function(o, data) {
    let particleId, x, y, z, radius, colorIdx;
    const shape = 'sphere'
    data.split(/\r?\n/).map( line => {
      [particleId, x, y, z, radius, colorIdx] = line.split(" ");
      if (!(particleId==undefined||x==undefined||y==undefined||z==undefined||radius==undefined||colorIdx==undefined)) {
        const colorSet = [colorIdx]
        o.plotSphere({ shape, particleId, x, y, z, colorSet, radius });
      } else {
        //console.log(`could not parse line: ${line}`);
      }
    });
  },

  loadFrameNum: function(frameNum) {
//console.log('loadFrameNum ', frameNum)
    this.frameNum = frameNum
    if (this.frameNum < this.data.startFrame) this.frameNum = this.totalFrames
    else if (this.frameNum > this.totalFrames) this.frameNum = this.data.startFrame
    this.frameTime = 0
  },

  previousFrame: function() {
    this.pauseAnimation()
    this.loadFrameNum(this.frameNum - 1)
  },
  nextFrame: function() {
    this.pauseAnimation()
    this.loadFrameNum(this.frameNum + 1)
  } ,

  setTotalFrames: function(totalFrames) {
    this.totalFrames = totalFrames
  },

  // pause animation
  pauseAnimation: function() {
    this.playState=2
  },

  // play animation
  playAnimation: function() {
    // if we are paused, buffer now, will auto play when buffer is full
    if (this.playState==2) {
      this.playState=1
    }
  },

  // get frame buffer index for frame num, returns -1 if not buffered
  getFrameBufferIdx: function(frameNum) {
    const idx = frameNum % this.frameBufferSize
    return (this.loadedFrames[idx] == frameNum) ? idx : -1
  },

  // called ~60 times per second
  tick: function(_, timeDelta) {
    // if in play mode
    if (this.playState == 1) {
      const frameAdvance = (this.frameTime + timeDelta) / this.frameDur
      const tweenWeight = frameAdvance % 1 // extract decimal
      const numFramesToAdvance = ~~frameAdvance // fast Math.floor that forces integer
      const currentFrame = this.frameNum + numFramesToAdvance
      const nextFrame = currentFrame + 1

      // set if we are at end
      if (nextFrame > this.totalFrames) {
        this.loadFrameNum(this.data.startFrame)
        return;
      }

      // make sure current and next frame are in buffer, it not, buffer now
      const frameIdx0 = this.getFrameBufferIdx(currentFrame)
      const frameIdx1 = this.getFrameBufferIdx(nextFrame)
      if (frameIdx0==-1 || frameIdx1==-1) {
        this.playState = 0  // buffer mode
        this.frameNum = currentFrame
        this.fetchFrame()   // fetch until we fill buffer
        return
      }
  
      this.frameTime = tweenWeight * this.frameDur; // ms into last played frame
  
      // update all particles locations, colors, etc
      for (let i=0,l=this.el.children.length; i<l; ++i) {
        const e = this.el.children[i]
        const p = e._StreamingAFrameProps
        if (! e.object3D) {
          console.log('WARNING: could not animate '+e.id+' because it is not loaded')
          continue;
        } else {
          if (p.lastSeenInFrame[frameIdx0] != currentFrame && p.lastSeenInFrame[frameIdx1] != nextFrame) {
            e.setAttribute('visible', false)
          }
          else {
            e.setAttribute('visible', true)

            if (p.collisions[frameIdx0] != undefined && p.collisions[frameIdx0].length > 0) {
              e.setAttribute('color', this.data.collisionColor || this.data.invalidColorDefault)
            } else {
              const colorIdx = p.colorSet[frameIdx0][this.colorSetIdx]
              const colorValue = (this.colorSets[this.colorSetIdx] && this.colorSets[this.colorSetIdx][colorIdx]) ? this.colorSets[this.colorSetIdx][colorIdx] : this.data.invalidColorDefault
              e.setAttribute('color', colorValue)
            }

            if (p.lastSeenInFrame[frameIdx0] == currentFrame && p.lastSeenInFrame[frameIdx1] == nextFrame) {
              e.object3D.children[0].material.opacity = 1
            } else if (p.lastSeenInFrame[frameIdx0] == currentFrame) {
              e.object3D.children[0].material.opacity = 1 - tweenWeight // fade out
console.log('fade out for ', e.id, '; frame: ', currentFrame)
            } else {
              e.object3D.children[0].material.opacity = tweenWeight // fade in
            }
          }
  
          e.object3D.position.set(
            p.x[frameIdx0] + ((p.x[frameIdx1] - p.x[frameIdx0]) * tweenWeight),
            p.y[frameIdx0] + ((p.y[frameIdx1] - p.y[frameIdx0]) * tweenWeight),
            p.z[frameIdx0] + ((p.z[frameIdx1] - p.z[frameIdx0]) * tweenWeight)
          );
        }
      }

      // update video player bar
      this.el.sceneEl.dispatchEvent(new CustomEvent('updatePlayTime', { detail: { weight: (currentFrame / this.totalFrames) + ((1/this.totalFrames) * tweenWeight) } }))

      this.frameNum = currentFrame
      if (! this.fetchPromise && numFramesToAdvance > 0) {
        this.fetchFrame() // used a frame so fetch the next one
      }
    }

    // if in pause mode update displayed frame
    else if (this.playState == 2) {
      const frameIdx = this.getFrameBufferIdx(this.frameNum)
      if (frameIdx == -1) {
        this.fetchFrame();
        return 
      }
      for (let i=0,l=this.el.children.length; i<l; ++i) {
        const e = this.el.children[i]
        const p = e._StreamingAFrameProps
        if (! e.object3D) {
          console.log('WARNING: could not animate '+e.id+' because it is not loaded')
          continue;
        } else {
          if (p.lastSeenInFrame[frameIdx] != this.frameNum) {
            e.setAttribute('visible', false)
          } else {
            e.setAttribute('visible', true)

            if (p.collisions[frameIdx] != undefined && p.collisions[frameIdx].length > 0) {
              e.setAttribute('color', this.data.collisionColor || this.data.invalidColorDefault)
            } else {
              const colorIdx = p.colorSet[frameIdx][this.colorSetIdx]
              const colorValue = (this.colorSets[this.colorSetIdx] && this.colorSets[this.colorSetIdx][colorIdx]) ? this.colorSets[this.colorSetIdx][colorIdx] : this.data.invalidColorDefault
              e.setAttribute('color', colorValue)
            }

            e.object3D.children[0].material.opacity = 1
            e.object3D.position.set(p.x[frameIdx], p.y[frameIdx], p.z[frameIdx])
          }
        }
      }

      // update video player bar
      this.el.sceneEl.dispatchEvent(new CustomEvent('updatePlayTime', { detail: { weight: this.frameNum/this.totalFrames } }))
    }
  },

  // called by parser to populate keyframe data for the most recent fetched frame
  plot: function(o) {
    if (o.particleId == undefined) throw 'missing particleId'
    if (o.shape == undefined) o.shape = 'sphere'
    if (o.shape == 'sphere' && o.radius == undefined) o.radius = 1
    if (o.x == undefined) o.x = 0
    if (o.y == undefined) o.y = 0
    if (o.z == undefined) o.z = 0
    if (o.collisions == undefined) o.collisions=[]
    else {
      for (let i=0,l=o.collisions.length;i<l;++i) {
        o.collisions[i] = parseInt(o.collisions[i], 10)
      }
    }

    if (o.colorSet == undefined || o.colorSet.length < 1) o.colorSet=[0]
    else {
      for (let i=0,l=o.colorSet.length;i<l;++i) {
        o.colorSet[i]=parseInt(o.colorSet[i],10) || 0
      }
    }

    const idname = 'p'+o.particleId
    let elem = document.getElementById(idname)
    let p; // shortcut for element properties

    // add new element if not exists
    if (! elem) {
      elem = document.createElement('a-' + o.shape)
      elem.id = idname
      elem.setAttribute('position',{ x: o.x, y: o.y, z: o.z})
      elem.setAttribute('visible',false)
      elem.setAttribute('radius', parseFloat(o.radius))
      elem.setAttribute('color', this.data.invalidColorDefault)
      elem.setAttribute('material', 'transparent: true')
      this.el.appendChild(elem)
      p = elem._StreamingAFrameProps = { lastSeenInFrame:[], x:[], y:[], z:[], radius:[], colorSet:[], collisions: [] }
    } else {
      p = elem._StreamingAFrameProps
    }

    p.lastSeenInFrame[this.frameBufferIdx] = this.frameNumBeingFetched
    p.x[this.frameBufferIdx] = parseFloat(o.x)
    p.y[this.frameBufferIdx] = parseFloat(o.y)
    p.z[this.frameBufferIdx] = parseFloat(o.z)
    p.radius[this.frameBufferIdx] = (o.radius == undefined) ? undefined : parseFloat(o.radius)
    p.colorSet[this.frameBufferIdx] = o.colorSet
    p.collisions[this.frameBufferIdx] = o.collisions
  },

  fetchFrame: function() {
    // if are already fetching a frame
    if (this.fetchPromise) {
      // do not interrupt fetch if current frame is being fetched or is already buffered
      if (this.frameNum == this.frameNumBeingFetched ||
          this.loadedFrames[this.frameNum % this.frameBufferSize] == this.frameNum) return

      // else abort current fetch
      //console.log('aborting fetch frame ', this.frameNumBeingFetched)
      this.fetchPromise.abort()
      this.fetchPromise = this.frameNumBeingFetched = undefined
    }

    // find a frame to fetch
    let lastFrameToLoad = this.frameNum + this.frameBufferSize - this.frameBackBufferSize
    if (lastFrameToLoad > this.totalFrames) lastFrameToLoad = this.totalFrames
    let fetchFrameNum
    for (let frameNum=this.frameNum; frameNum<=lastFrameToLoad; ++frameNum) {
      const idx = frameNum % this.frameBufferSize
      if (this.loadedFrames[idx] != frameNum) {
        fetchFrameNum = frameNum
        break
      }
    }

    // return if buffer is full of loaded frames
    if (fetchFrameNum == undefined) {
//console.log('autoplaying - buffer is full')
      if (this.playState==0) this.playState=1  // autoplay if we are buffering
      return
    }

    const url = this.srcTemplate.replace('<framenum>', fetchFrameNum)
    this.frameNumBeingFetched = fetchFrameNum

    const abortController = new AbortController()
    this.fetchPromise = fetch(url, { signal: abortController.signal }).then(resp => {
      if (resp.status==200) {
        return resp.text()
      } else if (resp.status==404) {
        // if it looks like we loaded last frame
        if (this.totalFrames == undefined) {
          this.totalFrames = fetchFrameNum - 1
        } else {
          console.log('Error: frame file not found for ' + url)
        }
        this.fetchPromise = this.frameNumBeingFetched = undefined
        return
      }
    }).then(data => {
      this.fetchPromise = undefined
      if (data==undefined) {
        console.log('Error: frame file is empty for ' + url)
        return
      }

      this.frameBufferIdx = fetchFrameNum % this.frameBufferSize
      this.loadedFrames[this.frameBufferIdx] = fetchFrameNum
      this.data.parser(this, data)
      this.fetchPromise = this.frameNumBeingFetched = undefined

      // if buffering, auto play if buffer is full
      if (this.playState==0 && ((fetchFrameNum - this.frameNum) >= (this.frameBufferSize - this.frameBackBufferSize))) {
        this.playState=1
      }

      // if we are buffering, fetch next frame
      if (this.playState==0) {
        this.fetchFrame()
      }
    }).catch(err => {
      if (err.name == 'AbortError') {} // ignore aborted requests
      else console.log('could not fetch ', url, '; error: ', err.name, '; exception: ', err)
    })

    // add abort method to fetch promise
    this.fetchPromise.abort = () => abortController.abort()
  }

})
