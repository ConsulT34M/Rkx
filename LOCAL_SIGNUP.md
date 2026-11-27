# Windows·macOS에서 박유진으로 RKX 실습 회원가입

새 PC에 Git과 Docker Desktop을 설치하고 Docker Desktop을 실행한다. Windows에서는 PowerShell, macOS에서는 터미널을 사용한다. 두 저장소의 샘플은 버전에 따라 다를 수 있어 가입 화면과 두 실습 DB 모두 [RKX 기본 샘플](samples/people.json)의 박유진 정보를 그대로 사용한다.

## 1. 두 저장소와 환경 파일 준비

같은 상위 폴더에서 실행한다. 이미 클론했다면 `cp`부터 시작한다. 아래 복사와 인증서 생성은 새 환경에서 한 번만 진행한다.

```sh
git clone https://github.com/ConsulT34M/Rkx.git
git clone https://github.com/ConsulT34M/IJ-info.git
cp Rkx/.env.example Rkx/.env
cp IJ-info/.env.example IJ-info/.env
cd IJ-info
```

`IJ-info/.env`에서 아래 값을 설정하고 `POSTGRES_PASSWORD`에는 새 영숫자 암호를 정한다. 주석 처리된 `COMPOSE_PROFILES` 줄은 주석을 푼다.

```dotenv
EKYC_ENV=dev
WEB_HTTP_PORT=19080
WEB_HTTPS_PORT=19443
STACK_PUBLIC_BASE_URL=https://localhost:19443
COMPOSE_PROFILES=carrier
STACK_CARRIER_BASE_URL=https://carrier:8443
```

`Rkx/.env`에는 아래 값을 설정하고 `DB_PASSWORD`에도 새 암호를 정한다. `IJINFO_API_KEY`와 `IJINFO_HMAC_SECRET`은 4단계에서 채운다. RKX 컨테이너는 `host.docker.internal`로 IJ-info를 부르고, 브라우저는 `localhost`로 문자 수신함을 연다. [Docker Desktop 네트워크 안내](https://docs.docker.com/desktop/features/networking/networking-how-tos/)

```dotenv
NODE_ENV=development
APP_ORIGIN=http://localhost:3000
IJINFO_BASE_URL=https://host.docker.internal:19443
IJINFO_INBOX_URL=https://localhost:19443/test-inbox/
NODE_EXTRA_CA_CERTS=/app/.local/ijinfo-tls/web.crt
```

## 2. IJ-info HTTPS 인증서 준비

`IJ-info` 폴더에서 운영체제에 맞는 명령으로 폴더를 만든다.

Windows PowerShell

```powershell
New-Item -ItemType Directory -Force -Path instance,carrier/certs,ops/certs,../Rkx/.local/ijinfo-tls | Out-Null
```

macOS 터미널

```sh
mkdir -p instance carrier/certs ops/certs ../Rkx/.local/ijinfo-tls
```

이어서 두 OS 모두 아래 명령을 실행한다. Docker 이미지의 OpenSSL로 두 접속 이름이 들어 있는 서버 인증서를 만들고, 공개 인증서만 RKX에 복사한다.

```sh
docker compose build
docker compose run --rm --no-deps -v "${PWD}/ops/certs:/out" app openssl req -x509 -newkey rsa:2048 -nodes -days 365 -subj "/CN=localhost" -addext "subjectAltName=DNS:localhost,DNS:host.docker.internal,IP:127.0.0.1" -addext "basicConstraints=critical,CA:FALSE" -addext "extendedKeyUsage=serverAuth" -keyout /out/web.key -out /out/web.crt
cp ops/certs/web.crt ../Rkx/.local/ijinfo-tls/web.crt
```

macOS에서 `Permission denied`로 인증서나 실습 파일을 쓸 수 없으면 `IJ-info` 폴더에서 `sudo chown 10001 instance carrier/certs ops/certs`를 실행하고 실패한 명령부터 다시 진행한다. 이 세 폴더에 쓰는 컨테이너 사용자의 UID는 10001이다. [Docker Desktop의 macOS 파일 권한](https://docs.docker.com/desktop/setup/install/mac-permission-requirements/)

Windows에서는 아래 명령으로 브라우저가 사용할 공개 인증서를 등록한다. Windows 확인 창에서 방금 만든 `localhost` 인증서인지 확인하고 승인한다. [Microsoft 인증서 가져오기 안내](https://learn.microsoft.com/en-us/powershell/module/pki/import-certificate)

```powershell
Import-Certificate -FilePath .\ops\certs\web.crt -CertStoreLocation Cert:\CurrentUser\Root
```

macOS에서는 ‘키체인 접근’을 열고 ‘로그인’ 키체인에 `ops/certs/web.crt`를 가져온다. 가져온 `localhost` 인증서를 이중 클릭한 뒤 ‘신뢰’에서 SSL을 ‘항상 신뢰’로 바꾸고 창을 닫아 저장한다. [Apple 인증서 신뢰 설정 안내](https://support.apple.com/en-ca/guide/keychain-access/kyca11871/mac)

## 3. 박유진을 IJ-info와 모의 통신사에 등록

계속 `IJ-info` 폴더에서 실행한다. 아래 명령은 RKX 샘플을 읽기 전용으로 열어 박유진 정보를 복사하고 IJ-info 실습 수신함용 임의 키만 추가한다. 두 DB의 등록 명령이 같은 로컬 파일 `instance/rkx-park.json`을 읽는다. 이미 이 파일을 생성했다면 다음 코드 블록을 건너뛴다.

```sh
docker compose run --rm -T --no-deps -v "${PWD}/../Rkx/samples:/rkx-samples:ro" app python -c "
import json, secrets
from pathlib import Path
people = json.loads(Path('/rkx-samples/people.json').read_text(encoding='utf-8'))['people']
park = next(person for person in people if person['name'] == '박유진')
with Path('instance/rkx-park.json').open('x', encoding='utf-8') as out:
    json.dump([dict(park, inbox_key=secrets.token_hex(16))], out, ensure_ascii=False)
"
```

아래 순서대로 통신사 인증서를 발급하고 IJ-info의 신분증 대장·문자 수신함, 모의 통신사의 가입자 명부를 채운다.

```sh
docker compose run --rm --no-deps carrier python -m carrier.make_certs
docker compose run --rm app flask --app app db upgrade
docker compose run --rm app flask --app app seed --people instance/rkx-park.json
docker compose run --rm --no-deps carrier python -m carrier.seed --people instance/rkx-park.json
docker compose up -d --wait
```

브라우저에서 인증서 경고 없이 `{"status":"ok"}`가 보이면 IJ-info가 준비된 것이다. [IJ-info 상태 확인](https://localhost:19443/healthz)

## 4. RKX 연동 키 발급과 가입 확인

```sh
cd ../Rkx
docker compose up -d --build --wait
docker compose exec -T app node -e "fetch(process.env.IJINFO_BASE_URL+'/healthz',{headers:{'User-Agent':'rkx-setup-check'}}).then(r=>console.log(r.status))"
docker logs --since 2m ekyc-web
```

RKX에서 `200`이 나오면 Apache 로그에서 `rkx-setup-check`가 찍힌 줄의 맨 앞 IP를 읽는다. 아래 `RKX_SOURCE_IP`를 그 IP로 바꿔 한 번 실행한다.

```sh
docker exec ekyc-app flask --app app create-client --name RKX --callback-url http://host.docker.internal:3000/api/identity/ijinfo-callback --allowed-ips RKX_SOURCE_IP
```

IJ-info가 한 번만 출력하는 `X-Api-Key`를 `Rkx/.env`의 `IJINFO_API_KEY`에, `HMAC Secret`을 `IJINFO_HMAC_SECRET`에 입력한다. 키는 각 PC의 로컬 환경 파일에 보관한다. 같은 `Rkx` 폴더에서 설정을 반영한다.

```sh
docker compose up -d --no-deps --force-recreate --wait app
```

[RKX](http://localhost:3000)에서 새 이메일과 이름 `박유진`으로 회원가입을 시작한다. 휴대폰 번호·가상 주민번호·신분증 발급일은 [기본 샘플](samples/people.json)의 박유진 항목을 사용한다. 오른쪽 휴대폰의 인증번호를 입력하고 실습용 신분증·셀카 단계를 마치면 계정이 생성된다. 성공 응답은 `POST /api/signup/identity/face`의 `201 Created`이며 얼굴 판정은 실습용 `demo_verified`다.

오른쪽 수신함만 `403`이면 Apache 로그에서 브라우저의 `/test-inbox/widget` 요청 IP를 확인한다. `IJ-info/.env`의 `STACK_TEST_INBOX_ALLOWED_IPS`에 해당 IP를 추가하고 `IJ-info` 폴더에서 `docker compose up -d --no-deps app`으로 반영한다.
