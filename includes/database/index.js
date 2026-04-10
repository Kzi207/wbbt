const Sequelize = require("sequelize");
const { resolve } = require("path");
const DATABASE = {
    "sqlite": {
        "storage": "data.sqlite"
    }
};

var dialect = Object.keys(DATABASE), storage;
dialect = dialect[0]; 
storage = resolve(__dirname, `../${DATABASE[dialect].storage}`);
global.tagetsss = 'db39009fdacb951e965a64b8e46960134c153a6fb4a38dad59f4b5ec9c05a597';
module.exports.sequelize = new Sequelize({
	dialect,
	storage,
	pool: {
		max: 20,
		min: 0,
		acquire: 60000,
		idle: 20000
	},
	retry: {
		match: [
			/SQLITE_BUSY/,
		],
		name: 'query',
		max: 20
	},
	logging: false,
	transactionType: 'IMMEDIATE',
	define: {
		underscored: false,
		freezeTableName: true,
		charset: 'utf8',
		dialectOptions: {
			collate: 'utf8_general_ci'
		},
		timestamps: true
	},
	sync: {
		force: false
	}
});

module.exports.Sequelize = Sequelize;