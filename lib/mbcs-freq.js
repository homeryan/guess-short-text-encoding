const jschardet = require('jschardet');
const iconv = require('iconv-lite');

const MBCS_PROBERS = {
  'SHIFT_JIS': jschardet.SJISProber,
  'GB2312': jschardet.GB2312Prober,
  'Big5': jschardet.Big5Prober,
  'EUC-KR': jschardet.EUCKRProber,
  'EUC-TW': jschardet.EUCTWProber,
  'EUC-JP': jschardet.EUCJPProber
};

const MBCS_CHAR_TO_FREQ_TABLES = {
  'SHIFT_JIS': jschardet.JISCharToFreqOrder,
  'GB2312': jschardet.GB2312CharToFreqOrder,
  'Big5': jschardet.Big5CharToFreqOrder,
  'EUC-KR': jschardet.EUCKRCharToFreqOrder,
  'EUC-TW': jschardet.EUCTWCharToFreqOrder,
  'EUC-JP': jschardet.JISCharToFreqOrder
};

module.exports = function mbcsFreq(buffer, encoding) {
  if (!MBCS_PROBERS.hasOwnProperty(encoding) || !MBCS_CHAR_TO_FREQ_TABLES.hasOwnProperty(encoding)) return;
  const prober = new MBCS_PROBERS[encoding];
  const freqTable = MBCS_CHAR_TO_FREQ_TABLES[encoding];

  prober.__getAverageFreq = function(aBuf) {
    this._mDistributionAnalyzer.__getOrder = function(aStr, aCharLen) {
      let order = -1;
      if( aCharLen === 2 ) { // we only care about 2-bytes character in our distribution analysis
        order = this.getOrder(aStr);
      } else { return -1; }
      if (order < 0) return -1;
      if (order > this._mTableSize) order = this._mTableSize;
      return order;
    };

    let aLen = aBuf.length;
    let totalFreq = 0;
    let totalChars = 0;
    for( let i = 0; i < aLen; i++ ) {
      let codingState = this._mCodingSM.nextState(aBuf[i]);
      if( codingState == jschardet.Constants.error ) {
        if( jschardet.Constants._debug ) {
          jschardet.log(this.getCharsetName() + ' prober hit error at byte ' + i + '\n');
        }
        this._mState = jschardet.Constants.notMe;
        break;
      } else if( codingState == jschardet.Constants.itsMe ) {
        this._mState = jschardet.Constants.foundIt;
        break;
      } else if( codingState == jschardet.Constants.start ) {
        let charLen = this._mCodingSM.getCurrentCharLen();
        let order;
        if( i == 0 ) {
          this._mLastChar[1] = aBuf[0];
          order = this._mDistributionAnalyzer.__getOrder(this._mLastChar, charLen);
          if (order < 0) continue;
        } else {
          order = this._mDistributionAnalyzer.__getOrder(aBuf.slice(i - 1, i + 1), charLen);
          if (order < 0) continue;
        }
        totalFreq += freqTable[order];
        ++totalChars;
      }
    }
    this._mLastChar[0] = aBuf[aLen - 1];
    return (totalChars > 0) ? (totalFreq / totalChars) : Number.MAX_SAFE_INTEGER;
  };

  return prober.__getAverageFreq(iconv.decode(buffer, 'latin1'));
};