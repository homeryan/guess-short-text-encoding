/* eslint-disable no-console */
const jschardet = require('jschardet');
const iconv = require('iconv-lite');
const levenshtein = require('fast-levenshtein');
const mbcsFreq = require('./mbcs-freq');

const ACCENT_RATIO = 0.20;
const FREQ_THRESHOLD = 2000;
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

  // Use UTF-8 as default encoding. 
  const utf8Result = tryDecoding(bufferToConvert, 'UTF-8');
  if (utf8Result) return 'UTF-8';

  const detected = tryToDetectEncoding(bufferToConvert);
  let encoding = detected.encoding;

  if (mbcsPossible(bufferToConvert) ||
    (detected.confidence < THRESHOLD_LIST[0] && ratioOfExtAscii(buffer) >= ACCENT_RATIO) ||
    (RARE_ENCODINGS.indexOf(encoding) > -1) && ratioOfExtAscii(buffer) >= ACCENT_RATIO) {
    encoding = mbcsDetect(bufferToConvert, detected);
  }

  if (encoding === null) encoding = FALLBACK_ENCODING;
  if (!iconv.encodingExists(encoding)) encoding = FALLBACK_ENCODING;
  // console.log(`Encoding: ${encoding} | Raw data: '${buffer.reduce((prev, curr) => `${prev}\\x${('0'+curr.toString(16)).slice(-2)}`, '')}'`);
  
  return encoding;
};

/*
 * Decode the buffer and then re-encode the decoded string.
 * If the result matches, the encoding is correct.
 */
const tryDecoding = (buf, encodingToTry) => {
  const decoded = iconv.decode(buf, encodingToTry);
  return (Buffer.compare(buf, iconv.encode(decoded, encodingToTry)) === 0) ? decoded : null;
};

const reEncode = (buffer, encoding) => 
  iconv.encode(iconv.decode(iconv.encode(iconv.decode(buffer, encoding), 'UTF-8'), 'UTF-8'), encoding);

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
  buffer.reduce((prev, curr) => prev + ('0' + (curr & 0xFF).toString(16)).slice(-2), '');

const mbcsDetect = (buffer, detected) => {
  let minFreq = Number.MAX_SAFE_INTEGER;
  let minDist = Number.MAX_SAFE_INTEGER;
  let minSize = Number.MAX_SAFE_INTEGER;

  const fdsList = MBCS_ENCODINGS.reduce((prev, encoding) => {
    const freq = Math.min(mbcsFreq(buffer, encoding), MAX_FREQ);
    minFreq = freq < minFreq ? freq : minFreq;
    const dist = levenshtein.get(bufferToHexString(buffer), bufferToHexString(reEncode(buffer, encoding)));
    minDist = dist < minDist ? dist : minDist;
    const size = iconv.decode(buffer, encoding).length;
    minSize = size < minSize ? size : minSize;
    prev.push({ encoding, freq, dist, size });
    return prev;
  }, []);

  const freqOrder = Array.from(fdsList).sort((a, b) => a.freq > b.freq);
  const sizeOrder = Array.from(fdsList).sort((a, b) => a.size > b.size);
  // const distOrder = Array.from(fdsList).sort((a, b) => a.dist > b.dist);

  if (detected.encoding === 'windows-1251' && minFreq > 1024 &&
    detected.confidence > CONFIDENCE_THRESHOLD &&
    minDist > Math.floor(buffer.length * 0.1)) {
    return detected.encoding;
  }

  if (freqOrder[0].size === minSize && freqOrder[0].dist === minDist) return freqOrder[0].encoding;

  // 3 encodings have the same size
  // if (sizeOrder[2].size === minSize) {
  //   if (freqOrder[0].dist <= freqOrder[1].dist) return freqOrder[0].encoding;
  //   return freqOrder[1].encoding;
  // }

  // 2 encodings have the same size, choose shortest Levenshtein distance
  if (sizeOrder[1].size === minSize) {
    if (sizeOrder[0].dist < sizeOrder[1].dist) return sizeOrder[0].encoding;
    if (sizeOrder[0].dist === sizeOrder[1].dist) {
      return sizeOrder[0].freq < sizeOrder[1].freq ? sizeOrder[0].encoding : sizeOrder[1].encoding;
    }
    return sizeOrder[1].encoding;
  }

  // return the smallest size
  return sizeOrder[0].encoding;
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

// const compareReEncode = (buffer, encoding) =>
//   Buffer.compare(reEncode(Buffer.from(buffer), encoding), Buffer.from(buffer));

module.exports = shortTextCharDetect;