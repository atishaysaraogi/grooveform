#!/usr/bin/env python3
"""Make the voice pack: one small clip for every phrase the coach can say, in
a natural (neural) voice, so the coach's page and its films carry it.

Needs, at build time only: the sherpa-onnx Python package and a Piper voice
(vits-piper-en_US-lessac-medium from the sherpa-onnx releases), and ffmpeg
(imageio-ffmpeg's static build is found automatically).

  pip install sherpa-onnx imageio-ffmpeg
  curl -L -o v.tar.bz2 https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-piper-en_US-lessac-medium.tar.bz2 && tar xjf v.tar.bz2
  python3 scripts/voice-pack.py vits-piper-en_US-lessac-medium

The list of phrases is the app's own (Speech.packTexts in public/js/speech.js),
so a new cue text is one run of this script away. Writes public/voice/*.mp3 and
public/voice/index.json; a clip already made for the same phrase is kept."""
import hashlib, json, os, re, subprocess, sys, tempfile
ROOT = os.path.join(os.path.dirname(__file__), '..')
OUT = os.path.join(ROOT, 'public', 'voice')
VOICE = sys.argv[1] if len(sys.argv) > 1 else 'vits-piper-en_US-lessac-medium'
NAME = os.path.basename(VOICE.rstrip('/')).replace('vits-piper-', '')

texts = json.loads(subprocess.check_output(['node', '-e',
    "const S=require('./public/js/speech.js'),M=require('./public/js/moves.js'),C=require('./public/js/core.js');console.log(JSON.stringify(S.packTexts(M,C)))"], cwd=ROOT))
import sherpa_onnx, imageio_ffmpeg
FF = imageio_ffmpeg.get_ffmpeg_exe()
cfg = sherpa_onnx.OfflineTtsConfig(model=sherpa_onnx.OfflineTtsModelConfig(vits=sherpa_onnx.OfflineTtsVitsModelConfig(
    model=os.path.join(VOICE, NAME + '.onnx'), lexicon='', tokens=os.path.join(VOICE, 'tokens.txt'), data_dir=os.path.join(VOICE, 'espeak-ng-data')), num_threads=2, provider='cpu'))
tts = sherpa_onnx.OfflineTts(cfg)
os.makedirs(OUT, exist_ok=True)
index_path = os.path.join(OUT, 'index.json')
old = json.load(open(index_path)).get('clips', {}) if os.path.exists(index_path) else {}
clips, made, kept = {}, 0, 0
def spoken(t):
    # the em dash is a pause in speech, not a word; a bare number is read as a count
    return t.replace(' — ', ', ').replace('—', ',')
for t in texts:
    name = hashlib.sha1(t.encode('utf8')).hexdigest()[:12] + '.mp3'
    clips[t] = name
    if old.get(t) == name and os.path.exists(os.path.join(OUT, name)): kept += 1; continue
    a = tts.generate(spoken(t), sid=0, speed=1.05)
    with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as w: wav = w.name
    sherpa_onnx.write_wave(wav, a.samples, a.sample_rate)
    subprocess.check_call([FF, '-hide_banner', '-loglevel', 'error', '-y', '-i', wav, '-af', 'silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse,apad=pad_dur=0.05',
                           '-c:a', 'libmp3lame', '-b:a', '48k', '-ac', '1', '-ar', str(a.sample_rate), os.path.join(OUT, name)])
    os.unlink(wav); made += 1
for f in os.listdir(OUT):
    if f.endswith('.mp3') and f not in clips.values(): os.unlink(os.path.join(OUT, f))
json.dump({'voice': NAME, 'engine': 'piper via sherpa-onnx', 'rate': 22050, 'format': 'mp3', 'count': len(clips), 'clips': clips}, open(index_path, 'w'), ensure_ascii=False, indent=0)
total = sum(os.path.getsize(os.path.join(OUT, f)) for f in clips.values())
print(f'{len(clips)} clips ({made} made, {kept} kept), {total/1e6:.1f} MB, voice {NAME}')
