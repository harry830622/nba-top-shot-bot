const mongoose = require('mongoose');

const { Schema } = mongoose;

const alertSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', require: true },
    moment: { type: Schema.Types.ObjectId, ref: 'Moment', require: true },
    budget: { type: Schema.Types.Number, default: 0 },
  },
  { timestamps: true },
);

alertSchema.index({ userId: 1, momentId: 1 });

const Alert = mongoose.model('Alert', alertSchema);

module.exports = Alert;
