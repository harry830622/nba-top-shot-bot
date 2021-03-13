const mongoose = require('mongoose');

const { Schema } = mongoose;

const momentSchema = new Schema(
  {
    url: { type: Schema.Types.String, required: true },
    playerName: { type: Schema.Types.String, required: true },
    playCategory: { type: Schema.Types.String, required: true },
    at: { type: Schema.Types.Date, required: true },
    setName: { type: Schema.Types.String, required: true },
    setSeriesNumber: { type: Schema.Types.Number, required: true },
    // TODO: Validate if the moment of an alert is actually this moment
    alerts: {
      type: [{ type: Schema.Types.ObjectId, ref: 'Alert', require: true }],
      default: [],
    },
  },
  { timestamps: true },
);

momentSchema.index({ playerName: 1 });

const moment = mongoose.model('Moment', momentSchema);

module.exports = moment;
