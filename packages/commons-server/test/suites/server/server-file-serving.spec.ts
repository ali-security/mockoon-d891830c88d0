import { BodyTypes, Environment, ServerErrorCodes } from '@mockoon/commons';
import { expect } from 'chai';
import { promises as fs } from 'fs';
import { get as httpGet } from 'http';
import { resolve as pathResolve } from 'path';
import { MockoonServer } from '../../../src';

async function getEnvironment(): Promise<Environment> {
  const environmentJson = await fs.readFile(
    './test/data/environments/test-env.json',
    'utf-8'
  );

  return JSON.parse(environmentJson) as Environment;
}

const buildRequest = (
  query: Record<string, string> = {},
  params: Record<string, string> = {}
) => ({ query, params }) as any;

const callGetSafeFilePath = (
  server: MockoonServer,
  filePath: string,
  request?: any
): string => (server as any).getSafeFilePath(filePath, request);

const getBody = (url: string): Promise<string> =>
  new Promise((resolve, reject) => {
    httpGet(url, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('end', () => resolve(body));
    }).on('error', reject);
  });

describe('Templated file path safety', () => {
  let environment: Environment;

  before(async () => {
    environment = await getEnvironment();
  });

  describe('getSafeFilePath', () => {
    it('should allow escaping when there is no templating', () => {
      const server = new MockoonServer(environment, {
        environmentDirectory: pathResolve('./test/data')
      });

      expect(callGetSafeFilePath(server, '../outside.json')).to.equal(
        pathResolve('./test', 'outside.json')
      );
    });

    it('should allow an absolute path when there is no templating', () => {
      const server = new MockoonServer(environment, {
        environmentDirectory: pathResolve('./test/data')
      });
      const absoluteFilePath = pathResolve('./package.json');

      expect(callGetSafeFilePath(server, absoluteFilePath)).to.equal(
        absoluteFilePath
      );
    });

    it('should allow templated relative paths staying in the environment directory', () => {
      const server = new MockoonServer(environment, {
        environmentDirectory: pathResolve('./test/data')
      });

      expect(
        callGetSafeFilePath(
          server,
          "./{{queryParam 'filename'}}",
          buildRequest({ filename: 'environments/test-env.json' })
        )
      ).to.equal(pathResolve('./test/data', 'environments/test-env.json'));
    });

    it('should block templated relative paths escaping the environment directory', () => {
      const server = new MockoonServer(environment, {
        environmentDirectory: pathResolve('./test/data')
      });

      expect(() =>
        callGetSafeFilePath(
          server,
          "./{{queryParam 'filename'}}",
          buildRequest({ filename: '../../package.json' })
        )
      ).to.throw(
        /Access to relative path outside of the environment base directory/
      );
    });

    it('should block templated relative paths escaping the environment directory through a route param', () => {
      const server = new MockoonServer(environment, {
        environmentDirectory: pathResolve('./test/data')
      });

      expect(() =>
        callGetSafeFilePath(
          server,
          "{{urlParam 'name'}}",
          buildRequest({}, { name: '../../package.json' })
        )
      ).to.throw(
        /Access to relative path outside of the environment base directory/
      );
    });

    it('should block templated relative paths escaping the current directory when no environment directory is provided', () => {
      const server = new MockoonServer(environment);

      expect(() =>
        callGetSafeFilePath(
          server,
          "./{{queryParam 'filename'}}",
          buildRequest({ filename: '../package.json' })
        )
      ).to.throw(
        /Access to relative path outside of the environment base directory/
      );
    });

    it('should allow templated absolute paths staying in the static base directory', () => {
      const server = new MockoonServer(environment, {
        environmentDirectory: pathResolve('./test/data')
      });
      const publicDir = pathResolve('./test/data/environments');

      expect(
        callGetSafeFilePath(
          server,
          `${publicDir}/{{queryParam 'filename'}}`,
          buildRequest({ filename: 'test-env.json' })
        )
      ).to.equal(pathResolve(publicDir, 'test-env.json'));
    });

    it('should block templated absolute paths escaping the static base directory', () => {
      const server = new MockoonServer(environment, {
        environmentDirectory: pathResolve('./test/data')
      });
      const publicDir = pathResolve('./test/data/environments');

      expect(() =>
        callGetSafeFilePath(
          server,
          `${publicDir}/{{queryParam 'filename'}}`,
          buildRequest({ filename: '../../../package.json' })
        )
      ).to.throw(
        /Access to absolute path outside of the original static base directory/
      );
    });

    it('should block a fully templated path resolving to an absolute path', () => {
      const server = new MockoonServer(environment, {
        environmentDirectory: pathResolve('./test/data')
      });

      expect(() =>
        callGetSafeFilePath(
          server,
          "{{queryParam 'filename'}}",
          buildRequest({ filename: pathResolve('./package.json') })
        )
      ).to.throw(
        /Access to absolute path outside of the original static base directory/
      );
    });
  });

  describe('File serving', () => {
    let server: MockoonServer;
    const emittedErrors: ServerErrorCodes[] = [];

    before((done) => {
      const fileEnvironment: Environment = JSON.parse(
        JSON.stringify(environment)
      );
      fileEnvironment.port = 3020;
      fileEnvironment.routes[0].endpoint = 'relative-file';
      fileEnvironment.routes[0].responses[0].bodyType = BodyTypes.FILE;
      fileEnvironment.routes[0].responses[0].sendFileAsBody = true;
      fileEnvironment.routes[0].responses[0].filePath =
        "./{{queryParam 'filename'}}";
      fileEnvironment.routes[1].endpoint = 'absolute-file';
      fileEnvironment.routes[1].responses[0].bodyType = BodyTypes.FILE;
      fileEnvironment.routes[1].responses[0].sendFileAsBody = true;
      fileEnvironment.routes[1].responses[0].filePath = `${pathResolve(
        './test/data/environments'
      )}/{{queryParam 'filename'}}`;

      server = new MockoonServer(fileEnvironment, {
        environmentDirectory: pathResolve('./test/data')
      });
      server.on('error', (errorCode) => {
        emittedErrors.push(errorCode);
      });
      server.on('started', () => done());
      server.start();
    });

    after((done) => {
      server.on('stopped', () => done());
      server.stop();
    });

    it('should serve a templated relative file inside the environment directory', async () => {
      const body = await getBody(
        'http://localhost:3020/relative-file?filename=plain.data'
      );

      expect(body).to.equal('plainTest');
    });

    it('should not serve a templated relative file outside of the environment directory', async () => {
      const body = await getBody(
        'http://localhost:3020/relative-file?filename=../../package.json'
      );

      expect(body).to.contain(
        'Error while serving the content: Access to relative path outside of the environment base directory'
      );
      expect(body).to.not.contain('@mockoon/commons-server');
      expect(emittedErrors).to.include(ServerErrorCodes.ROUTE_SERVING_ERROR);
    });

    it('should not serve a templated absolute file outside of the static base directory', async () => {
      const body = await getBody(
        'http://localhost:3020/absolute-file?filename=../../../package.json'
      );

      expect(body).to.contain(
        'Error while serving the content: Access to absolute path outside of the original static base directory'
      );
      expect(body).to.not.contain('@mockoon/commons-server');
    });
  });
});
