import { answer } from "../server";

/** Answers nothing: components that refresh with it keep the data the story gave them. */
export const getSwitcherGroups = async () => answer(undefined);
