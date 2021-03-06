const mqtt = require('mqtt');
const logger = require('winston');
const DeviceManager = require('./app/device_manager');

const networkAddress = process.env.NETWORK || '192.168.1.255';
const mqttServerAddress = process.env.MQTT_SERVER || 'mqtt://127.0.0.1';
const mqttBaseTopic = process.env.MQTT_BASE_TOPIC || 'ewpe-smart';
const pollInterval = process.env.DEVICE_POLL_INTERVAL || 5000;
const logFile = process.env.LOG_FILE || '/var/log/ewpe-smart-mqtt/app.log';
const consoleLogLevel = process.env.LOG_LEVEL || 'info';

const myFormat = logger.format.printf(info => {
    return `${info.timestamp} [${info.level}]: ${JSON.stringify(info.message)}`;
})

logger.configure({
    format: logger.format.combine(
        logger.format.timestamp(),
        logger.format.colorize(),
        logger.format.json(),
        myFormat
    ),
    transports: [
        new logger.transports.Console({
            level: consoleLogLevel,
            handleExceptions: true,
            colorize: true,
        }),
        new logger.transports.File({
            level: 'info',
            filename: logFile,
            handleExceptions: true,
            maxsize: 5242880, // 5MB
            maxFiles: 5,
            colorize: false
        })
    ]
});

const mqttClient = mqtt.connect(mqttServerAddress);

mqttClient.on('connect', () => {
    const deviceRegex = new RegExp(`^${mqttBaseTopic}\/([0-9a-h]{12})\/(.*)$`, 'i');
    const deviceManager = new DeviceManager(networkAddress, pollInterval);

    const getDeviceStatus = async (deviceId) => {
        const deviceStatus = await deviceManager.getDeviceStatus(deviceId);
        mqttClient.publish(`${mqttBaseTopic}/${deviceId}/status`, JSON.stringify(deviceStatus));
    }

    mqttClient.publish(`${mqttBaseTopic}/bridge/state`, 'online');
    mqttClient.subscribe(`${mqttBaseTopic}/#`);

    mqttClient.on('message', async (topic, message) => {
        let matches;

        logger.info(`MQTT message received: ${topic} ${message}`);

        if (topic === `${mqttBaseTopic}/devices/list`) {
            mqttClient.publish(`${mqttBaseTopic}/devices`, JSON.stringify(deviceManager.getDevices()))
        } else {
            matches = deviceRegex.exec(topic);

            if (matches !== null) {
                const [, deviceId, command] = matches;

                if (command === 'get') {
                    getDeviceStatus(deviceId);
                }

                if (command === 'set') {
                    const cmdResult = await deviceManager.setDeviceState(deviceId, JSON.parse(message));
                    mqttClient.publish(`${mqttBaseTopic}/${deviceId}/status`, JSON.stringify(cmdResult));
                }
            }
        }
    });

    deviceManager.on('device_bound', (deviceId, device) => {
        mqttClient.publish(`${mqttBaseTopic}/${deviceId}`, JSON.stringify(device));

        if (pollInterval > 0) {
            setInterval(() => getDeviceStatus(deviceId), pollInterval);
        }
    });
});