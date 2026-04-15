function parseRuntimeMessage(message) {
  if (typeof message !== 'string') {
    return null;
  }

  try {
    var parsed = JSON.parse(message);
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    return parsed;
  } catch (_) {
    return null;
  }
}

function getEvalErrorPayload(message) {
  var parsed = parseRuntimeMessage(message);
  if (!parsed || parsed.type !== 'evalError' || typeof parsed.error !== 'string') {
    return null;
  }

  var error = parsed.error.trim();
  if (!error) {
    return null;
  }

  return {
    error: error,
  };
}

function isEvalResultMessage(message) {
  var parsed = parseRuntimeMessage(message);
  return !!parsed && parsed.type === 'evalResult';
}

module.exports = {
  getEvalErrorPayload: getEvalErrorPayload,
  isEvalResultMessage: isEvalResultMessage,
  parseRuntimeMessage: parseRuntimeMessage,
};
