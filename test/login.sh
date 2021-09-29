#! /bin/bash

set -ex

BFF_URL="localhost:5010"
COOKIE_FILE="./cookies.txt"
RESPONSE_FILE="./response.txt"
USERNAME="user1"

# Start login with BFF
HTTP_STATUS=$(curl -X POST -is -c $COOKIE_FILE -H 'accept: application/json' $BFF_URL/start -o $RESPONSE_FILE -w '%{http_code}')

cat $RESPONSE_FILE
cat $COOKIE_FILE

if [ "$HTTP_STATUS" != '200' ]; then
    echo "*** Failed login with HTTP code $HTTP_STATUS"
    exit 1
else
    echo "> Login OK with HTTP code $HTTP_STATUS"
fi

AUTH_URL=$(tail -n1 $RESPONSE_FILE | jq -r .authRedirUrl)
if [ "$AUTH_URL" == '' ]; then
    echo "*** Got no authRedirUrl"
    exit 1
else
    echo "> Auth URL OK"
fi

# Continue login with identity provider
HTTP_STATUS=$(curl -is $AUTH_URL -o $RESPONSE_FILE -w '%{http_code}')
if [ "$HTTP_STATUS" != '200' ]; then
    echo "*** Failed IDP initial step with HTTP code $HTTP_STATUS"
    exit 1
else
    echo "> IDP OK with HTTP code $HTTP_STATUS"
fi

# Complete login
grep -q '<h2>Step 2: Authenticate</h2>' $RESPONSE_FILE

REQID=$(grep reqid $RESPONSE_FILE | sed -E 's/.*value=\"(.*)\".*/\1/')

HTTP_STATUS=$(curl -is -X POST -H "Content-Type: application/x-www-form-urlencoded" "http://localhost:5001/login" -d "username=$USERNAME&password=valid&reqid=$REQID" -o $RESPONSE_FILE -w '%{http_code}')
if [ "$HTTP_STATUS" != '200' ]; then
    echo "*** Failed IDP login step with HTTP code $HTTP_STATUS"
    exit 1
else
    echo "> IDP Login OK with HTTP code $HTTP_STATUS"
fi

# Consent step
grep -q '<h2>Step 3: Authorize?</h2>' $RESPONSE_FILE

REQID=$(grep reqid $RESPONSE_FILE | sed -E 's/.*value=\"(.*)\".*/\1/')

HTTP_STATUS=$(curl -is -X POST -H "Content-Type: application/x-www-form-urlencoded" "http://localhost:5001/approve" -d "approve=Approve&reqid=$REQID" -o $RESPONSE_FILE -w '%{http_code}')
if [ "$HTTP_STATUS" != '303' ]; then
    echo "*** Failed IDP consent step with HTTP code $HTTP_STATUS"
    exit 1
else
    echo "> IDP Consent step OK with HTTP code $HTTP_STATUS"
fi

# Response is redirection with code
LOC=$(egrep '^Location' $RESPONSE_FILE | sed -E 's/^location: (.*)/\1/i')
LOC="${LOC%%[[:cntrl:]]}"

CONT_JSON='{"pageUrl":"'$LOC'"}'
echo "Continuation payload: ${CONT_JSON}"

# Pass code on to BFF
HTTP_STATUS=$(curl -v -is -X POST -b $COOKIE_FILE -c $COOKIE_FILE -H 'content-type: application/json' -H 'accept: application/json' $BFF_URL/pageload -o $RESPONSE_FILE -d $CONT_JSON -w '%{http_code}')

cat $COOKIE_FILE

LOGGED_IN=$(tail -n1 $RESPONSE_FILE | jq -r .loggedIn)
if [ "$LOGGED_IN" != 'true' ]; then
    echo "*** Failed LoggedIn state $LOGGED_IN"
    exit 1
else
    echo "> Login OK"
fi

# Read ID token claims
HTTP_STATUS=$(curl -is -b $COOKIE_FILE -c $COOKIE_FILE -H 'accept: application/json' $BFF_URL/userinfo -o $RESPONSE_FILE -w '%{http_code}')
if [ "$HTTP_STATUS" != '200' ]; then
    echo "*** Failed reading userinfo with HTTP code $HTTP_STATUS"
    exit 1
else
    echo "> Read userinfo OK with HTTP code $HTTP_STATUS"
fi

# Test subject retreived from userinfo
tail -n1 $RESPONSE_FILE | jq .
SUB=$(tail -n1 $RESPONSE_FILE | jq -r .sub)
if [ "$SUB" != "$USERNAME" ]; then
    echo "*** Incorrect subject $SUB"
    exit 1
else
    echo "> Subject match"
fi




echo "*** Success ***"
