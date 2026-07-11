class MediaMTXWebRTCReader {
  static #RETRY_PAUSE = 2000;

  static #linkToIceServers(link) {
    if (link === null) {
      return [];
    }

    return link
      .split(",")
      .map((entry) => {
        const matches = entry.match(/<(.+)>;\s*rel="ice-server"/);
        if (matches === null) {
          return null;
        }

        const url = matches[1];
        const server = { urls: url };

        const params = new URLSearchParams(url.split("?")[1]);
        const username = params.get("username");
        if (username !== null) {
          server.username = username;
        }
        const credential = params.get("credential");
        if (credential !== null) {
          server.credential = credential;
        }

        return server;
      })
      .filter((entry) => entry !== null);
  }

  static async #supportsNonAdvertisedCodec(codec, parameters) {
    const pc = new RTCPeerConnection();
    try {
      const tc = pc.addTransceiver("audio", { direction: "recvonly" });

      if (RTCRtpReceiver.getCapabilities === undefined) {
        return false;
      }

      const caps = RTCRtpReceiver.getCapabilities("audio");
      if (caps === null || caps.codecs === undefined) {
        return false;
      }

      const parts = codec.split("/");
      const mimeType = `audio/${parts[0]}`;
      const clockRate = parseInt(parts[1], 10);
      const channels = parts[2] !== undefined ? parseInt(parts[2], 10) : undefined;

      const matches = caps.codecs.filter(
        (c) =>
          c.mimeType.toLowerCase() === mimeType.toLowerCase() &&
          c.clockRate === clockRate &&
          c.channels === channels,
      );
      if (matches.length === 0) {
        return false;
      }

      tc.setCodecPreferences(matches);

      const offer = await pc.createOffer();
      if (offer.sdp.toLowerCase().includes(codec.toLowerCase())) {
        if (parameters !== undefined) {
          return offer.sdp.toLowerCase().includes(parameters.toLowerCase());
        }
        return true;
      }
      return false;
    } catch (err) {
      return false;
    } finally {
      pc.close();
    }
  }

  static #parseOffer(sdp) {
    const lines = sdp.split("\r\n");

    let iceUfrag = null;
    let icePwd = null;
    const medias = [];

    for (const line of lines) {
      if (line.startsWith("a=ice-ufrag:")) {
        iceUfrag = line.substring(12);
      } else if (line.startsWith("a=ice-pwd:")) {
        icePwd = line.substring(10);
      } else if (line.startsWith("m=")) {
        medias.push(line.substring(2));
      }
    }

    return { iceUfrag, icePwd, medias };
  }

  static #enableStereoOpus(section) {
    const lines = section.split("\r\n");

    let payloadType = null;

    for (const line of lines) {
      if (line.startsWith("a=rtpmap:")) {
        const matches = line.match(/a=rtpmap:([0-9]+)\s*opus\/48000\/2/i);
        if (matches !== null) {
          payloadType = matches[1];
          break;
        }
      }
    }

    if (payloadType === null) {
      return section;
    }

    let fmtpLineIndex = null;
    let index = 0;

    for (const line of lines) {
      if (line.startsWith(`a=fmtp:${payloadType}`)) {
        fmtpLineIndex = index;
        break;
      }
      index++;
    }

    if (fmtpLineIndex !== null) {
      if (!lines[fmtpLineIndex].includes("stereo=1")) {
        lines[fmtpLineIndex] += ";stereo=1";
      }
    } else {
      lines.splice(lines.length - 1, 0, `a=fmtp:${payloadType} stereo=1`);
    }

    return lines.join("\r\n");
  }

  static #enableStereoPcmau(payloadTypes, section) {
    const lines = section.split("\r\n");

    let payloadType = null;

    for (const line of lines) {
      if (line.startsWith("a=rtpmap:")) {
        const matches = line.match(/a=rtpmap:([0-9]+)\s*pcma\/8000\/2/i);
        if (matches !== null) {
          payloadType = matches[1];
          break;
        }
      }
    }

    if (payloadType !== null) {
      return section;
    }

    payloadType = "130";

    const parts = lines[0].split(" ");
    parts.push(payloadType);
    lines[0] = parts.join(" ");

    lines.splice(
      lines.length - 1,
      0,
      `a=rtpmap:${payloadType} pcma/8000/2`,
    );

    payloadTypes.push(payloadType);

    return lines.join("\r\n");
  }

  static #enableMultichannelOpus(payloadTypes, section) {
    const lines = section.split("\r\n");

    let payloadType = null;

    for (const line of lines) {
      if (line.startsWith("a=rtpmap:")) {
        const matches = line.match(/a=rtpmap:([0-9]+)\s*multiopus\/48000\/6/i);
        if (matches !== null) {
          payloadType = matches[1];
          break;
        }
      }
    }

    if (payloadType !== null) {
      return section;
    }

    payloadType = "131";

    const parts = lines[0].split(" ");
    parts.push(payloadType);
    lines[0] = parts.join(" ");

    lines.splice(
      lines.length - 1,
      0,
      `a=rtpmap:${payloadType} multiopus/48000/6`,
      `a=fmtp:${payloadType} channel_mapping=0,4,1,2,3,5;num_streams=4;coupled_streams=2`,
    );

    payloadTypes.push(payloadType);

    return lines.join("\r\n");
  }

  static #enableL16(payloadTypes, section) {
    const lines = section.split("\r\n");

    let payloadType = null;

    for (const line of lines) {
      if (line.startsWith("a=rtpmap:")) {
        const matches = line.match(/a=rtpmap:([0-9]+)\s*L16\/48000\/2/i);
        if (matches !== null) {
          payloadType = matches[1];
          break;
        }
      }
    }

    if (payloadType !== null) {
      return section;
    }

    payloadType = "132";

    const parts = lines[0].split(" ");
    parts.push(payloadType);
    lines[0] = parts.join(" ");

    lines.splice(
      lines.length - 1,
      0,
      `a=rtpmap:${payloadType} L16/48000/2`,
    );

    payloadTypes.push(payloadType);

    return lines.join("\r\n");
  }

  static #editOffer(sdp, nonAdvertisedCodecs) {
    const sections = sdp.split("\r\nm=");

    const payloadTypes = sections[0]
      .split("\r\n")
      .filter((line) => line.startsWith("a=rtpmap:"))
      .map((line) => line.split(" ")[0].split(":")[1])
      .reduce((prev, cur) => [...prev, ...cur], []);

    for (let i = 1; i < sections.length; i++) {
      if (sections[i].startsWith("audio")) {
        sections[i] = this.#enableStereoOpus(sections[i]);

        if (nonAdvertisedCodecs.includes("pcma/8000/2")) {
          sections[i] = this.#enableStereoPcmau(payloadTypes, sections[i]);
        }
        if (nonAdvertisedCodecs.includes("multiopus/48000/6")) {
          sections[i] = this.#enableMultichannelOpus(payloadTypes, sections[i]);
        }
        if (nonAdvertisedCodecs.includes("L16/48000/2")) {
          sections[i] = this.#enableL16(payloadTypes, sections[i]);
        }

        break;
      }
    }

    return sections.join("\r\nm=");
  }

  static #generateSdpFragment(od, candidates) {
    const candidatesByMedia = {};
    for (const candidate of candidates) {
      const mid = candidate.sdpMLineIndex;
      if (candidatesByMedia[mid] === undefined) {
        candidatesByMedia[mid] = [];
      }
      candidatesByMedia[mid].push(candidate);
    }

    let frag = `a=ice-ufrag:${od.iceUfrag}\r\n` + `a=ice-pwd:${od.icePwd}\r\n`;

    let mid = 0;

    for (const media of od.medias) {
      if (candidatesByMedia[mid] !== undefined) {
        frag += `m=${media}\r\n` + `a=mid:${mid}\r\n`;

        for (const candidate of candidatesByMedia[mid]) {
          frag += `a=${candidate.candidate}\r\n`;
        }
      }
      mid++;
    }

    return frag;
  }

  #conf = null;
  #state = "getting_codecs";
  #pc = null;
  #offerData = null;
  #sessionUrl = null;
  #queuedCandidates = [];
  #restartTimeout = null;
  #nonAdvertisedCodecs = [];

  constructor(conf) {
    this.#conf = conf;
    this.#getNonAdvertisedCodecs();
  }

  close() {
    this.#state = "closed";

    if (this.#restartTimeout !== null) {
      window.clearTimeout(this.#restartTimeout);
      this.#restartTimeout = null;
    }

    if (this.#pc !== null) {
      this.#pc.close();
      this.#pc = null;
    }

    this.#offerData = null;

    if (this.#sessionUrl !== null) {
      fetch(this.#sessionUrl, {
        method: "DELETE",
      });
      this.#sessionUrl = null;
    }

    this.#queuedCandidates = [];
  }

  /** @param {string} err */
  #handleError(err) {
    if (this.#state === "running") {
      if (this.#pc !== null) {
        this.#pc.close();
        this.#pc = null;
      }

      this.#offerData = null;

      if (this.#sessionUrl !== null) {
        fetch(this.#sessionUrl, {
          method: "DELETE",
        });
        this.#sessionUrl = null;
      }

      this.#queuedCandidates = [];
      this.#state = "restarting";

      this.#restartTimeout = window.setTimeout(
        () => this.#restart(),
        MediaMTXWebRTCReader.#RETRY_PAUSE,
      );

      if (this.#conf.onError !== undefined) {
        this.#conf.onError(`${err}, retrying in some seconds`);
      }
    } else if (this.#state === "getting_codecs") {
      this.#state = "failed";

      if (this.#conf.onError !== undefined) {
        this.#conf.onError(err);
      }
    }
  }

  #restart() {
    this.#restartTimeout = null;
    this.#state = "running";
    this.#start();
  }

  #getNonAdvertisedCodecs() {
    Promise.all(
      [
        ["pcma/8000/2"],
        [
          "multiopus/48000/6",
          "channel_mapping=0,4,1,2,3,5;num_streams=4;coupled_streams=2",
        ],
        ["L16/48000/2"],
      ].map((c) =>
        MediaMTXWebRTCReader.#supportsNonAdvertisedCodec(c[0], c[1]).then(
          (r) => (r ? c[0] : false),
        ),
      ),
    )
      .then((c) => c.filter((e) => e !== false))
      .then((codecs) => {
        if (this.#state !== "getting_codecs") {
          throw new Error("closed");
        }

        this.#nonAdvertisedCodecs = codecs;
        this.#state = "running";
        this.#start();
      })
      .catch((err) => {
        this.#handleError(err.toString());
      });
  }

  #start() {
    this.#requestICEServers()
      .then((iceServers) => this.#setupPeerConnection(iceServers))
      .then((offer) => this.#sendOffer(offer))
      .then((answer) => this.#setAnswer(answer))
      .catch((err) => {
        this.#handleError(err.toString());
      });
  }

  #authHeader() {
    if (this.#conf.user !== undefined && this.#conf.user !== "") {
      const credentials = btoa(`${this.#conf.user}:${this.#conf.pass}`);
      return { Authorization: `Basic ${credentials}` };
    }
    if (this.#conf.token !== undefined && this.#conf.token !== "") {
      return { Authorization: `Bearer ${this.#conf.token}` };
    }
    return {};
  }

  #requestICEServers() {
    return fetch(this.#conf.url, {
      method: "OPTIONS",
      headers: this.#authHeader(),
    }).then((res) =>
      MediaMTXWebRTCReader.#linkToIceServers(res.headers.get("Link")),
    );
  }

  #setupPeerConnection(iceServers) {
    if (this.#state !== "running") {
      throw new Error("closed");
    }

    this.#pc = new RTCPeerConnection({
      iceServers,
      sdpSemantics: "unified-plan",
    });

    const direction = "recvonly";
    this.#pc.addTransceiver("video", { direction });
    this.#pc.addTransceiver("audio", { direction });

    this.#pc.createDataChannel("");

    this.#pc.onicecandidate = (evt) => this.#onLocalCandidate(evt);
    this.#pc.onconnectionstatechange = () => this.#onConnectionState();
    this.#pc.ontrack = (evt) => this.#onTrack(evt);
    this.#pc.ondatachannel = (evt) => this.#onDataChannel(evt);

    return this.#pc.createOffer().then((offer) => {
      offer.sdp = MediaMTXWebRTCReader.#editOffer(
        offer.sdp,
        this.#nonAdvertisedCodecs,
      );
      this.#offerData = MediaMTXWebRTCReader.#parseOffer(offer.sdp);

      return this.#pc.setLocalDescription(offer).then(() => offer.sdp);
    });
  }

  #sendOffer(offer) {
    if (this.#state !== "running") {
      throw new Error("closed");
    }

    return fetch(this.#conf.url, {
      method: "POST",
      headers: {
        ...this.#authHeader(),
        "Content-Type": "application/sdp",
      },
      body: offer,
    }).then((res) => {
      switch (res.status) {
        case 201:
          break;
        case 404:
          throw new Error("stream not found");
        case 400:
          return res.json().then((e) => {
            throw new Error(e.error);
          });
        default:
          throw new Error(`bad status code ${res.status}`);
      }

      this.#sessionUrl = new URL(
        res.headers.get("location"),
        this.#conf.url,
      ).toString();

      return res.text();
    });
  }

  #setAnswer(answer) {
    if (this.#state !== "running") {
      throw new Error("closed");
    }

    return this.#pc
      .setRemoteDescription(
        new RTCSessionDescription({
          type: "answer",
          sdp: answer,
        }),
      )
      .then(() => {
        if (this.#state !== "running") {
          return;
        }

        if (this.#queuedCandidates.length !== 0) {
          this.#sendLocalCandidates(this.#queuedCandidates);
          this.#queuedCandidates = [];
        }
      });
  }

  #onLocalCandidate(evt) {
    if (this.#state !== "running") {
      return;
    }

    if (evt.candidate !== null) {
      if (this.#sessionUrl === null) {
        this.#queuedCandidates.push(evt.candidate);
      } else {
        this.#sendLocalCandidates([evt.candidate]);
      }
    }
  }

  #sendLocalCandidates(candidates) {
    fetch(this.#sessionUrl, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/trickle-ice-sdpfrag",
        "If-Match": "*",
      },
      body: MediaMTXWebRTCReader.#generateSdpFragment(
        this.#offerData,
        candidates,
      ),
    })
      .then((res) => {
        switch (res.status) {
          case 204:
            break;
          case 404:
            throw new Error("stream not found");
          default:
            throw new Error(`bad status code ${res.status}`);
        }
      })
      .catch((err) => {
        this.#handleError(err.toString());
      });
  }

  #onConnectionState() {
    if (this.#state !== "running") {
      return;
    }

    if (
      this.#pc.connectionState === "failed" ||
      this.#pc.connectionState === "closed"
    ) {
      this.#handleError("peer connection closed");
    }
  }

  #onTrack(evt) {
    if (this.#conf.onTrack !== undefined) {
      this.#conf.onTrack(evt);
    }
  }

  #onDataChannel(evt) {
    if (this.#conf.onDataChannel !== undefined) {
      this.#conf.onDataChannel(evt);
    }
  }
}

window.MediaMTXWebRTCReader = MediaMTXWebRTCReader;
