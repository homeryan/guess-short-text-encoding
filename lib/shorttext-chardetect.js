/* eslint-disable no-console */
const jschardet = require('jschardet');
const iconv = require('iconv-lite');
const levenshtein = require('fast-levenshtein');
const mbcsFreq = require('./mbcs-freq');

const ACCENT_RATIO = 0.20;
const FREQ_THRESHOLD = 2000;              // for mbcs possibility check
const THRESHOLD_LIST = [0.4, 0.3, 0.2];
const CONFIDENCE_THRESHOLD = 0.7;         // for disdinguish between windows-1251 and mbcs
const FALLBACK_ENCODING = 'windows-1252';
const MBCS_ENCODINGS = ['GB2312', 'Big5', 'SHIFT_JIS'];
const RARE_ENCODINGS = ['ISO-8859-2', 'ISO-8859-5', 'IBM855'];
const MAX_FREQ = Math.max(jschardet.Big5CharToFreqOrder.length, 
  jschardet.GB2312CharToFreqOrder.length,
  jschardet.JISCharToFreqOrder.length);

const shortTextCharDetect = function (buffer) {
  const bufferToConvert = Buffer.from(buffer);
  if (isUTF8(bufferToConvert)) return 'UTF-8';  // Choose UTF-8 as default encoding

  const detected = tryToDetectEncoding(bufferToConvert);
  let encoding = detected.encoding;

  if (mbcsPossible(bufferToConvert) ||
    (detected.confidence < THRESHOLD_LIST[0] && ratioOfExtAscii(buffer) >= ACCENT_RATIO) ||
    (RARE_ENCODINGS.indexOf(encoding) > -1) && ratioOfExtAscii(buffer) >= ACCENT_RATIO) {
    encoding = mbcsDetect(bufferToConvert, detected);
  }

  if (encoding === null || !iconv.encodingExists(encoding)) encoding = FALLBACK_ENCODING;
  // console.log(`Encoding: ${encoding} | Raw data: '${buffer.reduce((prev, curr) => `${prev}\\x${('0'+curr.toString(16)).slice(-2)}`, '')}'`);
  
  return encoding;
};

const reEncode = (buffer, encoding) => 
  iconv.encode(iconv.decode(iconv.encode(iconv.decode(buffer, encoding), 'UTF-8'), 'UTF-8'), encoding);
  
// const compareReEncode = (buffer, encoding) =>
//   Buffer.compare(reEncode(Buffer.from(buffer), encoding), Buffer.from(buffer));

const isUTF8 = buffer => {
  return (Buffer.compare(buffer, iconv.encode(iconv.decode(buffer, 'UTF-8'), 'UTF-8')) === 0) ? true : false;
};

const numOfExtAscii = buf => buf.reduce((prev, curr) => prev + (curr >= 0x80 ? 1 : 0), 0);
const ratioOfExtAscii = buf => numOfExtAscii(buf) / buf.length;

const mbcsPossible = buffer => {
  let possible = false;
  MBCS_ENCODINGS.map(encoding => {
    if (mbcsFreq(buffer, encoding) < FREQ_THRESHOLD) possible = true;
  });
  return possible;
};

const bufferToHexString = buffer =>
  buffer.reduce((prev, curr) => `${prev}${('0' + (curr & 0xFF).toString(16)).slice(-2)}`, '');

const mbcsDetect = (buffer, detected) => {
  let minFreq = Number.MAX_SAFE_INTEGER;
  let minDist = Number.MAX_SAFE_INTEGER;
  const length = buffer.length;

  const sdfList = MBCS_ENCODINGS.reduce((prev, encoding) => {
    const freq = Math.min(mbcsFreq(buffer, encoding), MAX_FREQ);
    const dist = levenshtein.get(bufferToHexString(buffer), bufferToHexString(reEncode(buffer, encoding)));
    const size = iconv.decode(buffer, encoding).length;
    
    minDist = dist < minDist ? dist : minDist;
    minFreq = freq < minFreq ? freq : minFreq;
    
    // Choose encoding based on size, Levenshtein distance and frequency.
    prev.push( { encoding, sdf: (size/length*1000000 + dist/(length*2)*10000 + freq/MAX_FREQ*100) } );
    return prev;
  }, []);

  if (detected.encoding === 'windows-1251' && minFreq > 1024 &&
    detected.confidence > CONFIDENCE_THRESHOLD && minDist > Math.floor(length * 0.1)) {
    return detected.encoding;
  }

  return sdfList.sort((a, b) => a.sdf > b.sdf)[0].encoding;
};

const tryToDetectEncoding = buffer => {
  let detected = null;
  // If no encoding detected, try a lower threshold.
  for (let i = 0; i < THRESHOLD_LIST.length; i++) {
    jschardet.Constants.MINIMUM_THRESHOLD = THRESHOLD_LIST[i];
    detected = jschardet.detect(buffer);
    if (detected.encoding !== null) break;
  }
  return detected;
};

module.exports = shortTextCharDetect;