import AWS from 'aws-sdk';
import retry from 'retry-promise';
import App from './App';
import wait from './lib/utils/wait';

function buildKinesisParams(partitionKey, streamName, payload) {
  if (Object.keys(payload).length === 0) return Promise.resolve({});
  return {
    Data: JSON.stringify(payload),
    PartitionKey: partitionKey,
    StreamName: streamName
  };
}

function publishKinesisEvent(partitionKey, streamName, payload, kinesisClient = null) {
  const params = buildKinesisParams(partitionKey, streamName, payload);
  App.logger().debug('EventLog.publishKinesisEvent', JSON.stringify(params));
  const client = kinesisClient || new AWS.Kinesis({ region: process.env.SERVERLESS_REGION });
  return retry(client.putRecord(params).promise(), { max_tries: 10, interval: 50, backoff: 2 });
}

function publishKinesisEvents(partitionKey, streamName, events, kinesisClient = null) {
  App.logger().debug('EventLog.publishKinesisEvents', JSON.stringify(events));
  if (events.length === 0) return Promise.resolve();
  const records = events.map(e => ({ Data: JSON.stringify(e), PartitionKey: partitionKey }));
  const client = kinesisClient || new AWS.Kinesis({ region: process.env.SERVERLESS_REGION });
  // FIXME: Obvious reasons
  return client.putRecords({ Records: records, StreamName: streamName }).promise()
    .then((data) => {
      const unprocessedItems = data.Records
        .map((record, index) => (record.ErrorCode ? index : null))
        .filter(record => !!record)
        .map(current => records[current]);

      if (unprocessedItems.length === 0) return Promise.resolve(data);
      return wait(50)
        .then(() => client.putRecords({ Records: unprocessedItems, StreamName: streamName }).promise());
    }).then((data2) => {
      const unprocessedItems2 = data2.Records
        .map((record, index) => (record.ErrorCode ? index : null))
        .filter(record => !!record)
        .map((current, index) => records[index]);
      if (unprocessedItems2.length === 0) return Promise.resolve(data2);
      return wait(50)
        .then(() => client.putRecords({ Records: unprocessedItems2, StreamName: streamName }).promise());
    });
}

function write({ topic, streamName, payload }) {
  return publishKinesisEvent(topic, streamName, payload);
}

function batchWrite({ topic, streamName, data }) {
  return publishKinesisEvents(topic, streamName, data);
}

export default {
  write,
  batchWrite
};
