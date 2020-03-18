AFRAME.registerComponent('streamingkeyframes', {
  // define streamingkeyframes attributes and default values
  schema: {
    src:      { default: 'frames/<framenum>.txt' },  // directory where frame data exists
    startFrame: { default: 1 },
    frameDur: { default: 1000 },      // ms we should play each frame
    colorMap: { default: '#000000,#797979,#ffffff,#860000,#fframeIdx0000,#8c5c00,#ffa800,#827700,#ffframeIdx000,#138600,#18fframeIdx00,#000d72,#0012ff,#7d0070,#fframeIdx00e4' },
    parser:   {}
  },

  init: function(){
    const sceneEl = this.el.sceneEl
    sceneEl.addEventListener('playPause', evt => {
      if (this.playState==2) this.play()
      else this.pause()
    })
    sceneEl.addEventListener('setPlayTime', evt => {
      const frame = Math.ceil((this.totalFrames || 100) * evt.detail.weight)
      this.loadFrameNum(frame)
    })
    sceneEl.addEventListener('previousFrame', evt => {
      console.log('previousFrame')
    })
    sceneEl.addEventListener('nextFrame', evt => {
      console.log('nextFrame')
    })
    sceneEl.addEventListener('setPlaySpeed', evt => this.setPlaySpeed(evt.detail.playSpeed))
    sceneEl.addEventListener('resetView', evt => {
      this.reset()
    })
  },
    
  // called on initial load or when streamingkeyframes element changes
  update: function() {
console.log('update called')
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
    this.colorMap = this.data.colorMap.split(',');
    this.reset();
  },

  // restart keyframes
  reset: function() {
console.log('reset called')
    this.playState = 0;  // 0=buffering,playing=1,paused=2
    this.setPlaySpeed(1)
    this.totalFrames = undefined
    this.frameBufferSize=10  // how many keyframes to hold for each particle
    this.frameBackBufferSize = 2 // hold onto this many back frames to facilitate faster rewind
    this.loadedFrames = new Array(this.frameBufferSize)
    this.frameNum = this.data.startFrame
    this.frameNumDisplayed = undefined
    this.frameNumBeingFetched = undefined
    this.frameTime=0         // ms into the current animation frame
    this.fetchPromise=undefined
    this.fetchAbortController = new AbortController()
    while (this.el.firstChild) this.el.removeChild(this.el.firstChild)
    this.fetchFrame()
  },

  // speed: 1-10
  setPlaySpeed: function(speed) {
console.log('setPlaySpeed ', speed)
    this.frameDur = Math.ceil(this.data.frameDur / speed)
  },

  // default data parser - each line is in format: "<particleId> <x> <y> <z> <radius> <colorIdx>"
  parseSimpleText: function(o, data) {
    let particleId, x, y, z, radius, colorIdx;
    data.split(/\r?\n/).map( line => {
      [particleId, x, y, z, radius, colorIdx] = line.split(" ");
      if (!(particleId==undefined||x==undefined||y==undefined||z==undefined||radius==undefined||colorIdx==undefined)) {
        o.plotSphere(particleId, x, y, z, colorIdx, radius);
      } else {
        //console.log(`could not parse line: ${line}`);
      }
    });
  },

  loadFrameNum: function(frameNum) {
console.log('loadFrameNum ', frameNum)
    this.frameNum = frameNum
    this.frameTime = 0
  },

  setTotalFrames: function(totalFrames) {
//console.log('setTotalFrames ', totalFrames)
    this.totalFrames = totalFrames
  },

  // pause animation
  pause: function() {
    this.playState=2
  },

  // play animation
  play: function() {
    // if we are paused, buffer now, will auto play when buffer is full
    if (this.playState==2) {
      this.playState=0
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
      const numFramesToAdvance = ~~frameAdvance // fast Math.floor - get integer part
      const currentFrame = this.frameNum + numFramesToAdvance
      const nextFrame = currentFrame + 1

//console.log('frameAdvance: ', frameAdvance, '; tweenWeight: ', tweenWeight, '; numFramesToAdvance: ', numFramesToAdvance, '; currentFrame: ', currentFrame, '; nextFrame: ', nextFrame);

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
        console.log('fetch 1');
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
          e.setAttribute('color', this.colorMap[p.colorIdx[frameIdx0]] || 'pink')

          if (p.lastSeenInFrame[frameIdx0] != currentFrame && p.lastSeenInFrame[frameIdx1] != nextFrame) {
            e.setAttribute('visible', false)
          } else {
            e.setAttribute('visible', true)

            if (p.lastSeenInFrame[frameIdx0] == currentFrame && p.lastSeenInFrame[frameIdx1] == nextFrame) {
              e.object3D.children[0].material.opacity = 1
            } else if (p.lastSeenInFrame[frameIdx0] == currentFrame) {
              e.object3D.children[0].material.opacity = 1 - tweenWeight // fade out
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

      this.frameNumDisplayed = this.frameNum = currentFrame
      if (! this.fetchPromise && numFramesToAdvance > 0) {
//        console.log('fetch 2');
        this.fetchFrame() // used a frame so fetch the next one
      }
    }

    // if in pause mode update displayed frame
    else if (this.playState == 2) {
      if (this.frameNumDisplayed != this.frameNum) {
        const frameIdx = this.getFrameBufferIdx(this.frameNum)
        if (frameIdx == -1) {
//          console.log('fetch 3');
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
            e.setAttribute('color', this.colorMap[p.colorIdx[frameIdx]] || 'pink')
            e.setAttribute('visible', p.lastSeenInFrame[frameIdx] == this.FrameNum)
            e.object3D.children[0].material.opacity = 1
            e.object3D.position.set(p.x[frameIdx], p.y[frameIdx], p.z[frameIdx])
          }
        }
        this.frameNumDisplayed = this.frameNum
      }
    }
  },

  plotSphere: function(particleId, x, y, z, colorIdx, radius) {
    const idname = 'p'+particleId
    let elem = document.getElementById(idname)
    let p; // shortcut for element properties


    // add new element if not exists
    if (! elem) {
      elem = document.createElement('a-sphere')
      elem.id = idname
      elem.setAttribute('position',{x: x, y: y, z: z})
      elem.setAttribute('visible',false)
      elem.setAttribute('radius', parseFloat(radius))
      //elem.setAttribute('color', this.colorMap[colorIdx] || 'pink')
      //elem.setAttribute('material', 'transparent: true; color: '+this.colorMap[colorIdx] || 'pink')

      elem.setAttribute('color', this.colorMap[colorIdx] || 'pink')
      elem.setAttribute('material', 'transparent: true')
      this.el.appendChild(elem)
      p = elem._StreamingAFrameProps = { lastSeenInFrame:[], x:[], y:[], z:[], radius:[], colorIdx:[] }
    } else {
      p = elem._StreamingAFrameProps
    }

    p.lastSeenInFrame[this.frameBufferIdx] = this.frameNumBeingFetched
    p.x[this.frameBufferIdx] = parseFloat(x)
    p.y[this.frameBufferIdx] = parseFloat(y)
    p.z[this.frameBufferIdx] = parseFloat(z)
    p.radius[this.frameBufferIdx] = parseFloat(radius)

    if (!(colorIdx in this.colorMap)) {
      console.log(`invalid colorIdx: ${colorIdx} for frame: ${this.frameNumBeingFetched}; particle: ${particleId}`)
      colorIdx=0
    }

    p.colorIdx[this.frameBufferIdx] = parseInt(colorIdx, 10)
  },

  fetchFrame: function() {
    // if are already fetching a frame
    if (this.fetchPromise) {
      // do not interrupt fetch if current frame is being fetched or is already buffered
      if (this.frameNum == this.frameNumBeingFetched || this.loadedFrames[this.frameNum % this.frameBufferSize] == this.frameNum) return

      // else abort current fetch
      console.log('aborting fetch frame ', this.frameBeingFetched)
      this.fetchAbortController.abort()
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
console.log('autoplaying - buffer is full')
      if (this.playState==0) this.playState=1  // autoplay if we are buffering
      return
    }

    const url = this.srcTemplate.replace('<framenum>', fetchFrameNum)
    this.frameNumBeingFetched = fetchFrameNum
//console.log('fetching frame: ', fetchFrameNum)
    this.fetchPromise = fetch(url, { signal: this.fetchAbortController.signal }).then(resp => {
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
//        console.log('fetch 4')
        this.fetchFrame()
      }
    })
  }

})
