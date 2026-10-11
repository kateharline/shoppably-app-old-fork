// Two equally weighted stages; leave room for initialization after downloads.
export class LoadingProgress {
  constructor() {
    this.files = [new Map(), new Map()];
    this.completed = [false, false];
    this.value = 0;
  }
  update(stage, item) {
    if (item.file) {
      const files = this.files[stage];
      const fraction = item.status === "done" ? 1
        : Math.max(0, Math.min(1, (item.progress || 0) / 100));
      files.set(item.file, Math.max(files.get(item.file) || 0, fraction));
    }
    return this.measure();
  }
  finish(stage) {
    this.completed[stage] = true;
    return this.measure();
  }
  measure() {
    const total = this.files.reduce((sum, files, stage) => {
      if (this.completed[stage]) return sum + 50;
      const average = files.size ? [...files.values()].reduce((a, b) => a + b, 0) / files.size : 0;
      return sum + average * 45;
    }, 0);
    this.value = Math.max(this.value, total);
    return this.value;
  }
}
