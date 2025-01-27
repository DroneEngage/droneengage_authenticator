const zmq = require('zeromq');

class ZMQ_Publisher {
  constructor() {
    if (ZMQ_Publisher.instance) {
      return ZMQ_Publisher.instance;
    }
    
    this.m_publisher = new zmq.Publisher();
    ZMQ_Publisher.instance = this;
  }

  async bind(address = "tcp://127.0.0.1:5555") {
    await this.m_publisher.bind(address);
    console.log("Publisher bound to address:", address);
    await this.send("auth", {text:"Authenticator has started"});

  }

  async send(topic, message) {
    await this.m_publisher.send([topic, JSON.stringify(message)]);
  }

  static getInstance() {
    if (!ZMQ_Publisher.instance) {
      ZMQ_Publisher.instance = new ZMQ_Publisher();
    }
    return ZMQ_Publisher.instance;
  }
}

// Freeze the instance AFTER initialization
const instance = ZMQ_Publisher.getInstance();
Object.freeze(instance);
Object.freeze(ZMQ_Publisher.prototype);

module.exports = ZMQ_Publisher.getInstance();