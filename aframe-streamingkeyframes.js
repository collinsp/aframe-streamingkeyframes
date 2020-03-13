AFRAME.registerComponent('streamingkeyframes', {
  // define streamingkeyframes attributes and default values
  schema: {
    src:      { default: 'frames/<framenum>.txt' },  // directory where frame data exists
    frameDur: { default: 1000 },      // ms we should play each frame
    colorMap: { default: 'white,black,blue,green,orange,red,purple' },
    parser:   {}
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

  // called on initial load or when streamingkeyframes element changes
  update: function() {
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
    this.el.setAttribute('visible', false);
    this.playState = 0;  // 0=buffering,playing=1,paused=2
    this.lastFetchedFrame=undefined;
    this.lastLoadedFrame=undefined;
    this.lastPlayedFrame=undefined;
    this.startFrameRendered=false;
    this.frameTime=0;         // ms into the lastPlayedFrame
    this.frameBufferSize=10;  // how many keyframes to hold for each particle
    this.fetchPromise=undefined;
    while (this.el.firstChild) this.el.removeChild(this.el.firstChild);
    this.fetchFrame();
  },

  // pause animation
  pause: function() {
    this.playState=2;
  },

  // play animation
  play: function() {
    // if we are paused, buffer now, will auto play when buffer is full
    if (this.playState==2) this.playState=0;
  },

  // called each time a video frame is rendered
  tick: function(_, timeDelta) {
    if (this.playState != 1) return; // if not playing, return
    let frameAdvance = (this.frameTime + timeDelta) / this.data.frameDur;
    let timeFactor = frameAdvance % 1; // fast extract only decimal
    frameAdvance = ~~frameAdvance; // fast 32 bit unsigned Math.truncate

    // if we dont have a next keyframe do not advance the animation time
    // this will pause the animation until more frames are buffered
    if ((this.lastPlayedFrame + frameAdvance + 1) > this.lastLoadedFrame) {

      // if at end of animation, restart
      if ((this.lastPlayedFrame + 1) == this.data.lastFrame) {
        this.reset();
      }
      else {
        console.log('buffering animation since buffer is empty; you may need to increase the frameDur');
        this.playState=0;
        this.fetchFrame();
      }
      return;
    }

    if (frameAdvance) {
      this.lastPlayedFrame += frameAdvance;

      // reset animation if we passed last frame
      if (this.data.lastFrame != undefined && this.lastPlayedFrame > this.data.lastFrame) {
        this.reset(); 
        return; 
      }
    }

    this.frameTime = timeFactor * this.data.frameDur; // ms into last played frame
    let f0 = this.lastPlayedFrame % this.frameBufferSize;  // current frame index
    let f1 = (this.lastPlayedFrame + 1) % this.frameBufferSize; // next frame index

    let e, p; // short names for: elem, prop
    for (let i=0,l=this.el.children.length;i<l;++i) {
      e = this.el.children[i];
      p = e._StreamingAFrameProps;
      if (! e.object3D) {
        console.log('WARNING: could not animate '+e.id+' because it is not loaded');
      } else {

        // check to see if we need to change other immediate properties
        if (frameAdvance || ! this.startFrameRendered) {

          // dynamically changing radius has issues on firefox for some reason
          // the sphere appears huge and flashes on the screen, then next frame is corrected
          // it looks like changing the radius does not work well, perhaps will should dynamically set the scale instead?
          //if (p.radius[f0] != e.getAttribute('radius')) {
          //  e.setAttribute('radius', p.radius[f0]);
          //}
          e.setAttribute('color', this.colorMap[p.colorIdx[f0]] || 'pink');

          // control changes in visibility
          if (e.object3D.visible &&
              !(p.lastSeenInFrame[f0] >= this.lastPlayedFrame &&
                p.lastSeenInFrame[f1] >= this.lastPlayedFrame)) {
            e.setAttribute('visible', false);
          } else if (! e.object3D.visible &&
              p.lastSeenInFrame[f0] >= this.lastPlayedFrame &&
              p.lastSeenInFrame[f1] >= this.lastPlayedFrame) {
            e.setAttribute('visible', true);
          }
        }

        e.object3D.position.set(
          p.x[f0] + ((p.x[f1] - p.x[f0]) * timeFactor),
          p.y[f0] + ((p.y[f1] - p.y[f0]) * timeFactor),
          p.z[f0] + ((p.z[f1] - p.z[f0]) * timeFactor)
        );
      }
    }
    if (! this.startFrameRendered) {
      this.el.setAttribute('visible', true);
      this.startFrameRendered=true;
    }

    this.fetchFrame();
  },

  plotSphere: function(particleId, x, y, z, colorIdx, radius) {
    const idname = 'p'+particleId;
    let elem = document.getElementById(idname);
    let p; // shortcut for element properties


    // add new element if not exists
    if (! elem) {
      elem = document.createElement('a-sphere');
      elem.id = idname;
      elem.setAttribute('position',{x: x, y: y, z: z});
      elem.setAttribute('visible',false);
      elem.setAttribute('radius', parseFloat(radius));
      elem.setAttribute('color', this.colorMap[colorIdx] || 'pink');
      this.el.appendChild(elem);
      p = elem._StreamingAFrameProps = { lastSeenInFrame:[], x:[], y:[], z:[], radius:[], colorIdx:[] };
    } else {
      p = elem._StreamingAFrameProps;
    }

    p.lastSeenInFrame[this.frameBufferIdx] = this.lastLoadedFrame;
    p.x[this.frameBufferIdx] = parseFloat(x);
    p.y[this.frameBufferIdx] = parseFloat(y);
    p.z[this.frameBufferIdx] = parseFloat(z);
    p.radius[this.frameBufferIdx] = parseFloat(radius);

    if (!(colorIdx in this.colorMap)) {
      console.log(`invalid colorIdx: ${colorIdx} for frame: ${this.lastLoadedFrame}; particle: ${particleId}`);
      colorIdx=0;
    }

    p.colorIdx[this.frameBufferIdx] = parseInt(colorIdx, 10);
  },

  fetchFrame: function() {
    // if already fetching, return
    if (this.fetchPromise) return;

    // no more frames to fetch
    if (this.data.lastFrame != undefined && this.lastFetchedFrame >= this.data.lastFrame) {
      return;
    }

    if (this.lastFetchedFrame == undefined) {
      this.lastFetchedFrame = 0; 
    }

    // if buffer is full, we don't need to fetch more right now
    // reserve 1 slots so we don't write to buffer that is being actively used
    if (this.lastPlayedFrame != undefined && (this.lastLoadedFrame - this.lastPlayedFrame + 1) >= this.frameBufferSize) return;

    this.lastFetchedFrame++;

    var url = this.srcTemplate.replace('<framenum>', this.lastFetchedFrame);
    this.fetchPromise = fetch(url)
      .then(resp => {
        if (resp.status==200) {
          return resp.text();
        } else if (resp.status==404) {
          // if it looks like we loaded last frame
          if (this.data.lastFrame == undefined) {
            this.data.lastFrame = this.lastFetchedFrame - 1;
            return undefined;
          }
        }
      })
      .then(data => {
        this.fetchPromise = undefined;
        if (data!=undefined) {
          this.lastLoadedFrame = this.lastFetchedFrame;
          this.frameBufferIdx = this.lastLoadedFrame % this.frameBufferSize;
          this.data.parser(this, data);
        }

        // if buffering, auto play if ..
        if (this.playState==0 && (
             // if last frame was loaded
             (this.data.lastFrame!=undefined && this.lastLoadedFrame==this.data.lastFrame) ||
             // OR if we have not played anythig and the buffer is full
             (this.lastPlayedFrame==undefined && this.lastLoadedFrame == this.frameBufferSize) ||
             // OR if we have already started playing and the buffer is full again
             ((this.lastLoadedFrame - this.lastPlayedFrame - 1) > this.frameBufferSize))) {
          if (this.lastPlayedFrame == undefined) this.lastPlayedFrame = 1;
          this.playState=1;
          this.startFrameRendered=false;
        }
  
        if (this.data.lastFrame==undefined || this.lastLoadedFrame < this.data.lastFrame) {
          this.fetchFrame();
        }
      });
  }
});
