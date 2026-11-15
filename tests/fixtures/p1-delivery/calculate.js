(function execute(inputs, outputs) {
    var threshold = parseInt(inputs.threshold, 10)
    outputs.score = threshold * 2
    outputs.verdict = outputs.score > 100 ? 'high' : 'low'
})(inputs, outputs)
