import { DomainError } from "../../classes/errors/DomainError.js";
import { REPOSITORY_NAME } from "../../constants/repository/REPOSITORY_NAME.js";

export function requireRepositoryName(name: string): string {
  if (!REPOSITORY_NAME.test(name)) throw new DomainError(`Not a valid repository name: ${name}`);
  return name;
}
