import { proxify, subscribe } from ".";

const tests = [
  {
    test: () => {
      const a = proxify({} as {
        b?: {
          c?: {
            x: number;
            y: number;
            z?: {f: string}
          }
        }
      });

      let i = 0;
      let unsub = subscribe(() => a.b, () => {
        i++;
      });

      a.b = {};
      delete a.b;

      unsub();

      a.b = {};
      delete a.b;

      if (i !== 2) {
        throw Error("Fuck");
      }

      let unsubC = subscribe(() => a.b!.c, () => {
        i++;
      });
      let unsubX = subscribe(() => a.b!.c!.x, () => {
        i++;
      });
      let unsubF = subscribe(() => a.b!.c!.z!.f, () => {
        i++;
      });

      // Will make c subscription run because c goes from not found to undefined
      // (non existent in an object and undefined is the same for our purposes)
      a.b = {};
      a.b = {c: undefined};

      a.b.c = {x: 1, y: 2};

      i *= 1;
      if (i !== 5) {
        console.log(i);
        throw Error("No!");
      }

      a.b = {c: {x: 1, y: 2}};

      if (i !== 5) {
        throw Error("Fuck");
      }

      a.b = {c: {x: 1, y: 3}};

      i *= 1;
      if (i !== 6) {
        throw Error("Ass");
      }

      a.b.c!.z = {f: 'hello'};
      a.b.c!.z.f = "hell";

      i *= 1;
      if (i !== 10) {
        throw Error("Dang");
      }

      a.b = {c: {x: 2, y: 3, z: {f: 'heaven'}}};

      i *= 1;
      if (i !== 13) {
        throw Error("Hey now");
      }

      unsubC();
      unsubX();
      unsubF();

      a.b = {c: {x: 22, y: 3, z: {f: 'left behind'}}};

      if (i !== 13) {
        throw Error("Eat shit");
      }
    },
    title: 'nested'
  }, {
    test: () => {
      const a = proxify({
        b: 1,
        c: {
          d: 2,
          e: {
            f: {}
          }
        }
      });

      a.c.e.f = a.c;

      let passed = false;
      const unsubAce = subscribe(() => a.c.e, () => {
        passed = true;
      });

      a.c.d = 3;

      if (!passed) {
        throw Error("shite");
      }

      a.c.e.f = a;

      passed = false;
      a.b = 33;

      if (!passed) {
        throw Error("Fail");
      }

      unsubAce();

      const b = proxify({
        b: {c: {a: 1}},
        d: {e: {a: 1}}
      });

      b.b.c = b.d.e;

      passed = false;
      const unsubBbc = subscribe(() => b.b.c, () => {
        passed = true;
      });

      b.d.e.a = 2;

      if (!passed) {
        throw Error("It's joever");
      }

      unsubBbc();

      const unsubInfiloop = subscribe(() => b.b.c.a, () => {
        b.b.c.a++;
      });

      try {
        b.b.c.a++;
      } catch (e) {
        unsubInfiloop();
        if (e instanceof Error && e.message.includes("infinite loop")) {
          console.log('Infinite loop caught')
        } else {
          throw e;
        }
      }
    },
    disabled: false,
    title: 'cyclic and refs'
  }, {
    test: () => {
      const c = proxify({
        arr: [3]
      } as {
        arr?: number[];
      });

      delete c.arr;

      let i = 0;
      subscribe(() => c.arr!.length, () => {
        i++;
      });

      c.arr = [3];
      c.arr.push(2, 22);
      c.arr[2] = 4;
      c.arr.pop();
      c.arr.length = 0;

      if (i !== 5) {
        throw Error(":(");
      }
      i = 5;

      c.arr = [3,6];

      if (i !== 6) {
        throw Error("oh man, crap");
      }
    },
    title: 'array'
  }
];

for (const test of tests) {
  if (test.disabled) continue;
  try {
    console.info("Running test: \"" + test.title + '"');
    test.test();
    console.info("Test: \"" + test.title + '" was successful');
  } catch (e) {
    console.error("test: \"" + test.title + "\" failed");
    throw e;
  }
}
