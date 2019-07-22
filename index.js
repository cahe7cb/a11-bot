const jsdom = require('jsdom');
const { JSDOM } = jsdom;

const config = require('./config.json');
const tracks = require('./audio.json');

const Discord = require('discord.js');
const client = new Discord.Client();
client.login(config.token);


const names = require('./names.json');
const launch = new Date('2019-07-16T13:32:00.000Z');

const audio = {
  dispatcher: undefined,
  broadcast: undefined,
  connection: undefined,
};

function audioFindTrack(t) {
  for(let i = 0; i < tracks.length; i++) {
    const track = tracks[i];
    if(t >= track.start*60*60*1000 && t <= track.end*60*60*1000) {
      return track;
    }
  }
  throw new Error('No track found');
}

function createDispatcher(track, seek) {
  console.log('on track', track.v, 'seeking to', seek);
  const dispatcher = audio.broadcast.playFile(`./audio/${track.v}.m4a`, { seek: seek });
  dispatcher.on('error', (e) => console.log(e));
  dispatcher.on('end', () => console.log('end'));
  return dispatcher;
}

function startBroadcast(t, ref, delta) {
  const track = audioFindTrack(t - ref.getTime());
  const start = ref.getTime() + track.start*60*60*1000;
  const seek  = (t - start)/1000.0;
  const duration = (track.end - track.start) * 60*60;
  const delay = delta - (seek/duration) * (59*1000);
  // discordjs ffmpeg code needs some time to buffer
  setTimeout(() => audio.dispatcher = createDispatcher(track, seek), Math.max(1, delay));
}

function updateAudioState(t, ref, delta) {
  if(audio.dispatcher === undefined) {
    startBroadcast(t, ref, delta);
  }
  else {
    if(delta > 2*60*1000) {
      console.log('Player refresh');
      setTimeout(() => audio.dispatcher.end(), 60*1000);
      startBroadcast(t, ref, delta);
    }
  }
}

async function waitFor(c, ref) {
  const [d, h, m, s] = c.split(' ');
  let t = ref.getTime();
  t += d * 24*60*60*1000;
  t += h * 60*60*1000;
  t += m * 60*1000;
  t += s * 1000;
  const delta = t - Date.now();
  if (delta<0) {
    throw new Error('prior to now');
  } else {
    console.log(delta / 1000.0);
    updateAudioState(t, ref, delta);
    await new Promise(res => setTimeout(res, delta));
  }
  console.log(new Date(t));
}

async function* chat(defaultSkip = true) {
  const options = {};
  const dom  = await JSDOM.fromFile(config.source, options);
  const body = dom.window.document.body;
  const view = dom.window.document.defaultView;

  let skip = true;
  let currentSpeaker = names['CC'];
  for(const e of body.childNodes) {
    const text = e.textContent.trim();
    if (!text.length) continue;
    const res = /^(\d\d \d\d \d\d \d\d)$/.exec(text);
    if(res !== null) {
      skip = false;
      await waitFor(res[1], launch).catch(()=>{
        skip = defaultSkip;
      });
    } else {
      if (e instanceof view.HTMLFontElement) {
        currentSpeaker = names[text] || text;
      } else if (!skip) {
        yield [currentSpeaker, text];
      }
    }
  }
}

client.on('ready', async ()=>{
  const channel = client.channels.get(config.channel);
  const voice = client.channels.get(config.voiceChannel);
  voice.join().then(async (connection) => {
    audio.connection = connection;
    audio.broadcast = client.createVoiceBroadcast()
    audio.connection.playBroadcast(audio.broadcast);
    const chatLog = chat();
    for await (const msg of chatLog) {
      channel.send(msg);
    }
  });
});
