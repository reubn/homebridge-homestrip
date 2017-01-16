export default colour => {
  const {r, g, b} = colour.toRgb()
  return `\x1b[38;2;${r};${g};${b}m█\x1b[0m`
}
