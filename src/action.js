const url = require('url');
const axios = require('axios').default;
const cheerio = require('cheerio');

const User = require('./models/User');
const Moment = require('./models/Moment');
const Alert = require('./models/Alert');

const logger = require('./logger');

const sendHelp = async (context) => {
  await context.sendText(
    `Usage:
/watch - Send me notifications if the moment I want is below a certain price
/list - List the moments I am watching right now
/account - Show my account value
/status - Check if the site is under maintenance
/numbers - Give me some stats
/abort - Cancel the current operation
/help - How to use this bot?

FAQs:
1. How to update the budget of my watched moments?
Just /watch the same moment again and enter a different price
2. How to stop watching a certain moment?
Just /watch the same moment again and set the budget to 0
`,
  );
};

const sendAccount = async (context, { user }) => {
  const res = await axios.get(
    `https://momentranks.com/account/${user.nbaTopShotUsername}`,
  );
  const $ = cheerio.load(res.data);
  const data = JSON.parse($('#__NEXT_DATA__').html()).props.pageProps;
  const { account } = data;
  await context.sendText(
    `
Total Value: $${new Intl.NumberFormat('en-US').format(
      account.totalValue.toFixed(0),
    )}
Lifetime Profit: $${new Intl.NumberFormat('en-US').format(
      account.profit.toFixed(0),
    )}
ROI: ${
      account.totalValue - account.profit > 0
        ? `${(
            100 *
            (account.profit / (account.totalValue - account.profit))
          ).toFixed(2)}%`
        : '∞ 🔥'
    }
Number of Moments: ${account.mintCount}
Average Value of My Moments: $${new Intl.NumberFormat('en-US').format(
      (account.totalValue / account.mintCount).toFixed(2),
    )}
Rank: #${account.rank}
Percentile: Top ${(100 * account.percentile).toFixed(2)}%
Total Value Based on Lowest Listings: $${new Intl.NumberFormat('en-US').format(
      account.floorValue.toFixed(0),
    )}
`,
  );
};

const root = async (context) => {
  try {
    logger.info(JSON.stringify(context.event));

    if (!context.event.message) {
      return;
    }

    context.nextState = { ...context.state };

    if (!context.nextState.userId) {
      const f = {
        telegramChatId: context.event.message.chat.id,
      };
      const existedUser = await User.findOne(f).exec();
      if (!existedUser) {
        await User.create({
          ...f,
          telegramUsername: context.event.message.chat.username,
        });
      }
      const user = await User.findOne(f).exec();
      context.nextState = {
        ...context.nextState,
        userId: user._id,
      };
    }

    const commandEntity = context.event.message?.entities?.find(
      (e) => e.type === 'bot_command',
    );
    let command;
    if (commandEntity) {
      const { text } = context.event.message;
      command = text.slice(
        commandEntity.offset,
        commandEntity.offset + commandEntity.length,
      );
    }
    // const args = text
    //   .slice(commandEntity.offset + commandEntity.length)
    //   .trim()
    //   .split(' ')
    //   .filter((s) => s.length !== 0);

    if (command === '/abort') {
      await context.sendText('Cancelled');
      context.nextState = {
        ...context.nextState,
        state: 'IDLE',
        settingAlert: {
          userId: null,
          momentId: null,
          budget: 0,
        },
      };
      context.setState(context.nextState);
      return;
    }

    switch (context.nextState.state) {
      case 'IDLE': {
        if (!command) {
          await context.sendText('Please /help to see how to use');
          break;
        }
        context.nextState = {
          ...context.nextState,
          state: `${command.slice(1).toUpperCase()}__INIT`,
        };
        break;
      }
      default: {
        break;
      }
    }

    switch (true) {
      case /HELP__*/.test(context.nextState.state): {
        switch (context.nextState.state) {
          case 'HELP__INIT': {
            await sendHelp(context);
            context.nextState = {
              ...context.nextState,
              state: 'IDLE',
            };
            break;
          }

          default: {
            context.nextState = {
              ...context.nextState,
              state: 'IDLE',
            };
            break;
          }
        }
        break;
      }

      case /START__*/.test(context.nextState.state): {
        switch (context.nextState.state) {
          case 'START__INIT': {
            await context.sendText('Welcome!');
            await sendHelp(context);
            context.nextState = {
              ...context.nextState,
              state: 'IDLE',
            };
            break;
          }

          default: {
            context.nextState = {
              ...context.nextState,
              state: 'IDLE',
            };
            break;
          }
        }
        break;
      }

      case /WATCH__*/.test(context.nextState.state): {
        switch (context.nextState.state) {
          case 'WATCH__INIT': {
            await context.sendText(
              'Which moment would you like to watch? (Please enter the listing URL)',
            );
            context.nextState = {
              ...context.nextState,
              state: 'WATCH__WAITING_FOR_URL',
            };
            break;
          }

          case 'WATCH__WAITING_FOR_URL': {
            const listingUrl = url.format(new URL(context.event.text.trim()), {
              auth: false,
              fragment: false,
              search: false,
            });
            const res = await axios.get(listingUrl);
            const $ = cheerio.load(res.data);
            const momentData = JSON.parse($('#__NEXT_DATA__').html()).props
              .pageProps.moment;
            const {
              playerName,
              playCategory,
              dateOfMoment,
            } = momentData.play.stats;
            const { flowName, flowSeriesNumber } = momentData.set;
            const f = {
              url: listingUrl,
              playerName,
              playCategory,
              at: dateOfMoment,
              setName: flowName,
              setSeriesNumber: flowSeriesNumber,
            };
            const existedMoment = await Moment.findOne(f).exec();
            if (!existedMoment) {
              await Moment.create(f);
            }
            const moment = await Moment.findOne(f).exec();
            context.nextState = {
              ...context.nextState,
              settingAlert: {
                ...context.nextState.settingAlert,
                momentId: moment._id,
              },
            };
            await context.sendText(
              `Notify me when a ${moment.playerName} ${moment.playCategory} ${moment.setName}(Series ${moment.setSeriesNumber}) moment is listed below? (in USD)`,
            );
            context.nextState = {
              ...context.nextState,
              state: 'WATCH__WAITING_FOR_BUDGET',
            };
            break;
          }

          case 'WATCH__WAITING_FOR_BUDGET': {
            const budget = Number(context.event.text.trim());
            if (Number.isNaN(budget)) {
              throw new Error('This is not a number');
            }
            context.nextState = {
              ...context.nextState,
              settingAlert: {
                ...context.nextState.settingAlert,
                budget,
              },
            };
            const f = {
              user: context.nextState.userId,
              moment: context.nextState.settingAlert.momentId,
            };
            const existedAlert = await Alert.findOne(f).exec();
            if (!existedAlert) {
              const alert = await Alert.create(f);
              await Moment.findByIdAndUpdate(
                context.nextState.settingAlert.momentId,
                {
                  $push: {
                    alerts: alert._id,
                  },
                },
              ).exec();
              await User.findByIdAndUpdate(context.nextState.userId, {
                $push: {
                  watchedAlerts: alert._id,
                },
              }).exec();
            }
            await Alert.findOneAndUpdate(f, {
              budget: context.nextState.settingAlert.budget,
            }).exec();
            context.nextState = {
              ...context.nextState,
              settingAlert: {
                userId: null,
                momentId: null,
                budget: 0,
              },
            };
            await context.sendText(
              'You are all set, just wait for notifications and get some great steals!',
            );
            context.nextState = {
              ...context.nextState,
              state: 'IDLE',
            };
            break;
          }

          default: {
            context.nextState = {
              ...context.nextState,
              state: 'IDLE',
            };
            break;
          }
        }
        break;
      }

      case /LIST__*/.test(context.nextState.state): {
        switch (context.nextState.state) {
          case 'LIST__INIT': {
            const user = await User.findById(context.nextState.userId)
              .populate('watchedAlerts')
              .exec();
            const watchedAlerts = await Promise.all(
              user.watchedAlerts.map((alert) =>
                alert.populate('moment').execPopulate(),
              ),
            );
            await context.sendText(
              watchedAlerts
                .map(
                  (alert, idx) =>
                    `${idx + 1}. ${alert.moment.playerName} ${
                      alert.moment.playCategory
                    } ${alert.moment.setName}(Series ${
                      alert.moment.setSeriesNumber
                    }) under $${alert.budget}`,
                )
                .join('\n'),
            );
            context.nextState = {
              ...context.nextState,
              state: 'IDLE',
            };
            break;
          }

          default: {
            context.nextState = {
              ...context.nextState,
              state: 'IDLE',
            };
            break;
          }
        }
        break;
      }

      case /ACCOUNT__*/.test(context.nextState.state): {
        switch (context.nextState.state) {
          case 'ACCOUNT__INIT': {
            const user = await User.findOne({
              telegramChatId: context.event.message.chat.id,
            }).exec();
            if (!user.nbaTopShotUsername) {
              await context.sendText("What's your NBA Top Shot username?");
              context.nextState = {
                ...context.nextState,
                state: 'ACCOUNT__WAITING_FOR_NBA_TOP_SHOT_USERNAME',
              };
              break;
            }
            await sendAccount(context, { user });
            context.nextState = {
              ...context.nextState,
              state: 'IDLE',
            };
            break;
          }

          case 'ACCOUNT__WAITING_FOR_NBA_TOP_SHOT_USERNAME': {
            const nbaTopShotUsername = context.event.text.trim();
            const user = await User.findOneAndUpdate(
              {
                telegramChatId: context.event.message.chat.id,
              },
              { nbaTopShotUsername },
              { new: true },
            ).exec();
            await sendAccount(context, { user });
            context.nextState = {
              ...context.nextState,
              state: 'IDLE',
            };
            break;
          }

          default: {
            context.nextState = {
              ...context.nextState,
              state: 'IDLE',
            };
            break;
          }
        }
        break;
      }

      case /STATUS__*/.test(context.nextState.state): {
        switch (context.nextState.state) {
          case 'STATUS__INIT': {
            const res = await axios.get('https://status.nbatopshot.com/');
            const $ = cheerio.load(res.data);
            const rows = $('.components-section .component-inner-container');
            const statusByService = Object.fromEntries(
              rows
                .text()
                .split(/[?\n]/)
                .map((s) => s.trim())
                .filter((s) => s !== '')
                .reduce(
                  (prev, curr, idx, arr) => [
                    ...prev,
                    ...(idx % 2 === 1 ? [[arr[idx - 1], curr]] : []),
                  ],
                  [],
                ),
            );
            await context.sendText(
              `${Object.entries(statusByService)
                .map(
                  ([service, status]) =>
                    `${service}: ${status === 'Operational' ? '✅' : '🚧'}`,
                )
                .join('\n')}
See more details at https://status.nbatopshot.com/
`,
            );
            context.nextState = {
              ...context.nextState,
              state: 'IDLE',
            };
            break;
          }

          default: {
            context.nextState = {
              ...context.nextState,
              state: 'IDLE',
            };
            break;
          }
        }
        break;
      }

      case /NUMBERS__*/.test(context.nextState.state): {
        switch (context.nextState.state) {
          case 'NUMBERS__INIT': {
            const [
              totalMarketCap,
              [totalVolumeToday, totalNumSalesToday],
            ] = await Promise.all([
              (async () => {
                const res = await axios.get('https://momentranks.com/');
                const $ = cheerio.load(res.data);
                const data = JSON.parse($('#__NEXT_DATA__').html()).props
                  .pageProps;
                return data.marketCap;
              })(),
              (async () => {
                const res = await axios.get('https://momentranks.com/sales');
                const $ = cheerio.load(res.data);
                const data = JSON.parse($('#__NEXT_DATA__').html()).props
                  .pageProps;
                return [data.salesToday, data.volumeToday];
              })(),
            ]);
            await context.sendText(
              `Total Market Cap: $${new Intl.NumberFormat('en-US').format(
                totalMarketCap.toFixed(0),
              )}
Total Volume Today: $${new Intl.NumberFormat('en-US').format(
                totalVolumeToday.toFixed(0),
              )}
Total Number of Sales Today: ${new Intl.NumberFormat('en-US').format(
                totalNumSalesToday,
              )}
Average Price of a Moment Today: $${new Intl.NumberFormat('en-US').format(
                (totalVolumeToday / totalNumSalesToday).toFixed(2),
              )}
`,
            );
            context.nextState = {
              ...context.nextState,
              state: 'IDLE',
            };
            break;
          }

          default: {
            context.nextState = {
              ...context.nextState,
              state: 'IDLE',
            };
            break;
          }
        }
        break;
      }

      default: {
        context.nextState = {
          ...context.nextState,
          state: 'IDLE',
        };
        break;
      }
    }

    context.setState(context.nextState);
  } catch (err) {
    logger.error(err);
    await context.sendText(
      `Error occurred: ${err}, please try again or /abort`,
    );
  }
};

module.exports = root;
