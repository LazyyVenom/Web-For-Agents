/** Own (not inherited) property check that works on null-prototype objects. */
export const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);
