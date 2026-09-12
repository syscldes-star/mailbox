import mongoose, { Schema, type Document, type Model } from "mongoose";

export interface IUser extends Document {
  email: string;
  passwordHash: string;
  firstName: string;
  lastName: string;
  avatarUrl?: string;
  activeWorkspaceId?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema<IUser>(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    passwordHash: {
      type: String,
      required: true,
      // Never returned from queries by default (e.g. GET /me) -- callers
      // that genuinely need it (login) must explicitly opt in with
      // .select("+passwordHash").
      select: false,
    },
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    avatarUrl: { type: String },
    // Which workspace this user is currently "in" -- most requests infer
    // workspaceId from this rather than requiring the client to pass it
    // on every call, since a user's active workspace changes rarely.
    activeWorkspaceId: { type: Schema.Types.ObjectId, ref: "Workspace" },
  },
  { timestamps: true }
);

// Mongoose recompiles models on every hot-reload in dev unless guarded --
// `mongoose.models.User` survives module reloads, a fresh compile doesn't.
export const User: Model<IUser> = mongoose.models.User ?? mongoose.model<IUser>("User", UserSchema);