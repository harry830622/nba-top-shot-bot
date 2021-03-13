const url = require('url');
const axios = require('axios').default;
const cheerio = require('cheerio');

const User = require('./models/User');
const Moment = require('./models/Moment');
const Alert = require('./models/Alert');

const root = async (context) => {
  try {
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

      case /HELP__*/.test(context.nextState.state): {
        switch (context.nextState.state) {
          case 'HELP__INIT': {
            await context.sendText(
              `Command List:
/watch - Send notifications if the moment you want is below a certain price
/list - List the moments you are watching right now
/abort - Cancel the current operation
/help - How to use this bot?

FAQs:
1. How to update the budget of my watched moments?
Just /watch the same moment again and enter a different price
2. How to stop watching a certain moment?
Just /watch the same moment again and set your budget to 0`,
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
        break;
      }
    }

    context.setState(context.nextState);
  } catch (err) {
    console.error(err);
    await context.sendText(
      `Error occurred: ${err}, please try again or /abort`,
    );
  }
};

module.exports = root;
