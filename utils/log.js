const chalk = require('chalk');
const gradient = require("gradient-string");
const themes = [
  'dream', 'fiery', 'pastel', 'cristal',
  'retro', 'sunlight', 'teen', 'summer', 'flower', 'ghost',
];

const theme = themes[Math.floor(Math.random() * themes.length)];
let co;

if (theme === 'dream') {
  co = gradient([{ color: "blue", pos: 0.2 }, { color: "pink", pos: 0.3 }, { color: "gold", pos: 0.6 }, { color: "pink", pos: 0.8 }, { color: "blue", pos: 1 }]);
} else if (theme === 'fiery') {
  co = gradient("#fc2803", "#fc6f03", "#fcba03");
} else if (theme === 'pastel') {
  co = gradient.pastel;
} else if (theme === 'cristal') {
  co = gradient.cristal;
} else if (theme === 'retro') {
  co = gradient.retro;
} else if (theme === 'sunlight') {
  co = gradient("orange", "#ffff00", "#ffe600");
} else if (theme === 'teen') {
  co = gradient.teen;
} else if (theme === 'summer') {
  co = gradient.summer;
} else if (theme === 'flower') {
  co = gradient.pastel;
} else if (theme === 'ghost') {
  co = gradient.mind;
} else {
  co = gradient("#243aff", "#4687f0", "#5800d4");
}
module.exports = (text, type) => {
  switch (type) {
    case "warn":
      process.stderr.write(co(`\r[ ERROR ] > ${text}`) + '\n');
      break;
    case "error":
      process.stderr.write(chalk.bold.hex("#ff0000").bold(`\r[ ERROR ]`) + ` > ${text}` + '\n');
      break;
    default:
      process.stderr.write(chalk.bold(co(`\r${String(type).toUpperCase()} ${text}`) + '\n'));
      break;
  }
};

module.exports.loader = (data, option) => {
  switch (option) {
    case "warn":
      console.log(chalk.bold(co("[ WARNING ] > ")) + co(data))
      break;
    case "error":
      console.log(chalk.bold(co("[ ERROR ] > ")) + chalk.bold(co(data)))
      break;
    default:
      console.log(chalk.bold(co("[ LOADING ] > ")) + chalk.bold(co(data)))
      break;
  }
}

module.exports.load = (data, option) => {
  let coloredData = '';

  switch (option) {
    case 'warn':
      coloredData = gradient("blue", "purple", "yellow", "#81ff6e")('[ LOGIN ] >' + data);
      console.log(chalk.bold(coloredData));
      break;
    case 'error':
      coloredData = chalk.bold.hex('#FF0000')('[ ERROR ] >') + chalk.bold.red(data);
      console.log(coloredData);
      break;
    default:
      coloredData = gradient("blue", "purple", "yellow", "#81ff6e")('[ LOGIN ] >' + data);
      console.log(chalk.bold(coloredData));
      break;
  }
};

module.exports.autoLogin = async (onBot, botData) => {
  onBot(botData);
};
module.exports.co = co; 