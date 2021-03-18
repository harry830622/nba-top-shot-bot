const { getClient } = require('bottender');
const mongoose = require('mongoose');
const fcl = require('@onflow/fcl');
const t = require('@onflow/types');

const Moment = require('./models/Moment');
const Alert = require('./models/Alert');
const User = require('./models/User');

const logger = require('./logger');

require('dotenv').config();

const { MONGODB_URI, FLOW_ACCESS_NODE } = process.env;

const POLL_INTERVAL_IN_MS = 1000;

const GET_LISTED_MOMENT_SCRIPT = `
import TopShot from 0x0b2a3299cc857e29
import Market from 0xc1e4f4f4c4257510
pub struct Moment {
  pub var id: UInt64
  pub var playId: UInt32
  pub var setId: UInt32
  pub var serialNumber: UInt32
  init(moment: &TopShot.NFT) {
    self.id = moment.id
    self.playId = moment.data.playID
    self.setId = moment.data.setID
    self.serialNumber = moment.data.serialNumber
  }
}
pub fun main(momentId: UInt64, owner: Address): Moment {
  let acct = getAccount(owner)
  let collectionRef = acct.getCapability(/public/topshotSaleCollection)!.borrow<&{Market.SalePublic}>() ?? panic("Could not borrow capability from public collection")
  let moment = collectionRef.borrowMoment(id: momentId) ?? panic("Could not borrow moment from public collection")
  return Moment(moment: moment)
}
`;
const GET_MOMENT_META_SCRIPT = `
import TopShot from 0x0b2a3299cc857e29
pub struct MomentMeta {
  pub var playMetaData: {String: String}?
  pub var setName: String?
  pub var setSeries: UInt32?
  init(playId: UInt32, setId: UInt32) {
    self.playMetaData = TopShot.getPlayMetaData(playID: playId)
    self.setName = TopShot.getSetName(setID: setId)
    self.setSeries = TopShot.getSetSeries(setID: setId)
  }
}
pub fun main(playId: UInt32, setId: UInt32): MomentMeta {
  return MomentMeta(playId: playId, setId: setId)
}
`;

(async () => {
  const client = getClient('telegram');

  await mongoose.connect(MONGODB_URI, {
    useNewUrlParser: true,
    useCreateIndex: true,
    useFindAndModify: true,
    useUnifiedTopology: true,
  });

  fcl.config().put('accessNode.api', FLOW_ACCESS_NODE);

  let res;
  let lastEndHeight;
  setInterval(async () => {
    res = await fcl.send([fcl.getLatestBlock(true)]).then(fcl.decode);
    const blockHeight = res.height;
    if (blockHeight === lastEndHeight) {
      return;
    }
    const startHeight = lastEndHeight ? lastEndHeight + 1 : blockHeight;
    const endHeight = blockHeight;
    lastEndHeight = endHeight;

    const evtType = 'A.c1e4f4f4c4257510.Market.MomentListed';
    logger.info(
      `Fetching ${evtType} events from block height ${startHeight} to ${endHeight}:`,
    );
    const listedEvts = await fcl
      .send([fcl.getEvents(evtType, startHeight, endHeight)])
      .then(fcl.decode);

    const moments = await Promise.all(
      listedEvts.map((e) =>
        fcl
          .send([
            fcl.script(GET_LISTED_MOMENT_SCRIPT),
            fcl.args([
              fcl.arg(e.data.id, t.UInt64),
              fcl.arg(e.data.seller, t.Address),
            ]),
          ])
          .then(fcl.decode),
      ),
    );

    const momentMetas = await Promise.all(
      moments.map((m) =>
        fcl
          .send([
            fcl.script(GET_MOMENT_META_SCRIPT),
            fcl.args([fcl.arg(m.playId, t.UInt32), fcl.arg(m.setId, t.UInt32)]),
          ])
          .then(fcl.decode),
      ),
    );

    const listings = new Array(listedEvts.length).fill(null).map((_, idx) => ({
      playerName: momentMetas[idx].playMetaData.FullName,
      playCategory: momentMetas[idx].playMetaData.PlayCategory,
      at: momentMetas[idx].playMetaData.DateOfMoment,
      setName: momentMetas[idx].setName,
      setSeriesNumber: momentMetas[idx].setSeries,
      serialNumber: moments[idx].serialNumber,
      price: Number(listedEvts[idx].data.price),
    }));
    logger.info(JSON.stringify(listings));

    await Promise.all(
      listings.map(
        async ({
          playerName,
          playCategory,
          at,
          setName,
          setSeriesNumber,
          serialNumber,
          price,
        }) => {
          const moment = await Moment.findOne({
            playerName,
            playCategory,
            at,
            setName,
            setSeriesNumber,
          })
            .populate('alerts')
            .exec();
          if (moment) {
            await Promise.all(
              moment.alerts.map(async (alert) => {
                if (price <= alert.budget) {
                  const { user } = await alert.populate('user').execPopulate();
                  logger.info(`Sending notification for alert:${alert._id}...`);
                  await client.sendMessage(
                    user.telegramChatId,
                    `*${playerName}*
${playCategory}
${setName}(Series ${setSeriesNumber})
#${serialNumber}
is just listed for *$${price.toFixed(2)}*!
(which is within your budget ${alert.budget.toFixed(2)})
Grab it now at ${moment.url}`,
                    { parseMode: 'markdown' },
                  );
                  logger.info(`Sent notification for alert:${alert._id}`);
                }
              }),
            );
          }
        },
      ),
    );
  }, POLL_INTERVAL_IN_MS);
})();
